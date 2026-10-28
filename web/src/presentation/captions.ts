import { deck } from "@ava/shared";
import type { ResponseKind } from "../voice/types.js";
import { matchSources } from "./matchSources.js";

export interface CaptionLine {
  id: string;
  who: "you" | "ava";
  text: string;
  final: boolean;
  /** Closed with a dash because playback was cleared. */
  interrupted: boolean;
  /** A user line waiting for its asynchronous transcript. */
  pending: boolean;
  sources: string[];
  factIds: string[];
}

const MAX_LINES = 60;

/**
 * Narration said much more than its scripted sentence: the model padded a lead-in or ad-libbed.
 * Detection only (a debug flag and a counter); playback is never blocked. Bridged sentences get
 * extra room for the short resume, return or reconnect line.
 */
export function narrationOverrun(spoken: string, scripted: string, bridged: boolean): boolean {
  return spoken.trim().length > scripted.length * 1.5 + (bridged ? 70 : 25);
}

/**
 * The caption log (arch §4.4, §5.4). User lines are keyed by conversation item, agent lines by
 * response. A user line is reserved when the turn commits, so a late transcript still lands above
 * the answer it triggered.
 */
export class CaptionLog {
  private lines: CaptionLine[] = [];
  private snap: readonly CaptionLine[] = [];
  private closed = new Set<string>();
  private kinds = new Map<string, ResponseKind>();

  get view(): readonly CaptionLine[] {
    return this.snap;
  }

  clear() {
    this.lines = [];
    this.closed.clear();
    this.kinds.clear();
    this.commit();
  }

  /** Reserve the user's line at commit time, before the answer is requested. */
  reserveUser(itemId: string) {
    if (this.find(itemId)) return;
    this.push({
      id: itemId,
      who: "you",
      text: "",
      final: false,
      interrupted: false,
      pending: true,
      sources: [],
      factIds: [],
    });
  }

  /** A typed question: its text is known at once. */
  userTyped(itemId: string, text: string) {
    this.push({
      id: itemId,
      who: "you",
      text,
      final: true,
      interrupted: false,
      pending: false,
      sources: [],
      factIds: [],
    });
  }

  /** Non-final transcripts are deltas; the final one is the whole transcript. */
  user(itemId: string, text: string, final: boolean) {
    const line = this.find(itemId);
    if (!line) {
      this.push({
        id: itemId,
        who: "you",
        text,
        final,
        interrupted: false,
        pending: false,
        sources: [],
        factIds: [],
      });
      return;
    }
    const next = final ? text : line.text + text;
    this.update(itemId, { text: next, final, pending: !final && next.length === 0 });
  }

  /** Remove a reserved user line that never got words (a confirmed empty turn). */
  dropUser(itemId: string) {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => !(l.id === itemId && l.who === "you" && !l.text));
    if (this.lines.length !== before) this.commit();
  }

  /**
   * Agent caption text. `cancelled` responses get no new text: their late deltas are dropped.
   * Generated text may lead playback; it is never a playback clock.
   */
  agent(
    responseId: string,
    delta: string,
    final: boolean,
    kind: ResponseKind | undefined,
    cancelled: boolean,
  ) {
    if (cancelled || this.closed.has(responseId)) return;
    if (kind) this.kinds.set(responseId, kind);
    const line = this.find(responseId);
    if (!line) {
      if (!delta && final) return;
      this.push({
        id: responseId,
        who: "ava",
        text: delta,
        final,
        interrupted: false,
        pending: false,
        sources: [],
        factIds: [],
      });
    } else {
      this.update(responseId, { text: line.text + delta, final });
    }
    if (final) this.finalize(responseId);
  }

  /** Playback was cleared: close the line with a dash and ignore later deltas. */
  interrupted(responseId: string) {
    this.closed.add(responseId);
    const line = this.find(responseId);
    if (line && !line.final) this.update(responseId, { interrupted: true, final: true });
    else if (line && line.final && !line.interrupted) {
      // The text was fully generated but not fully heard.
      this.update(responseId, { interrupted: true });
    }
  }

  textOf(id: string) {
    return this.find(id)?.text ?? "";
  }

  factIdsOf(ids: string[]) {
    return [...new Set(ids.flatMap((id) => this.find(id)?.factIds ?? []))];
  }

  private finalize(responseId: string) {
    const kind = this.kinds.get(responseId);
    if (kind !== "answer" && kind !== "continuation") return;
    const line = this.find(responseId);
    if (!line) return;
    const m = matchSources(line.text, deck);
    this.update(responseId, { sources: m.sources, factIds: m.factIds });
  }

  private find(id: string) {
    return this.lines.find((l) => l.id === id);
  }

  private push(line: CaptionLine) {
    this.lines = [...this.lines, line].slice(-MAX_LINES);
    this.commit();
  }

  private update(id: string, patch: Partial<CaptionLine>) {
    this.lines = this.lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    this.commit();
  }

  private commit() {
    this.snap = this.lines;
  }
}
