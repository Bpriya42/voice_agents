import WebSocket from "ws";
import { answerReanchor, sessionConfig, slideById, SLIDE_IDS, type SlideId } from "@ava/shared";
import type { EvalResult, ToolCallRecord } from "./checks.js";

type Ev = Record<string, unknown> & { type?: string };

export interface TurnOutcome extends EvalResult {
  preamble: string;
  /** Conversation items this turn added (user message, model output, tool results). */
  itemIds: string[];
  userItemId: string;
  /** total_tokens of the turn's last response, i.e. the context the model just worked with. */
  totalTokens: number | null;
  /** Slide shown after the turn (goto_slide moves it, as in the controller). */
  slide: SlideId;
}

const MAX_CONTINUATIONS = 2;
const TIMEOUT_MS = 30_000;
/** Backoff between retries of a failed response; the test seam shortens it. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

const isSlide = (v: unknown): v is SlideId =>
  typeof v === "string" && (SLIDE_IDS as readonly string[]).includes(v);

/**
 * A Realtime text-output session driven from Node (arch §5.8). It uses the same sessionConfig() as
 * the app, so the model, instructions and tools under test are the product's own. The key comes
 * from the caller and is only ever sent in the Authorization header.
 */
export class RealtimeText {
  slide: SlideId = "intro";
  private slideNoteId: string | null = null;
  private waiters = new Set<(ev: Ev) => void>();
  private failure: Error | null = null;

  private constructor(private ws: WebSocket) {
    ws.on("message", (raw) => {
      const ev = JSON.parse(String(raw)) as Ev;
      if (ev.type === "error") {
        const e = (ev["error"] ?? {}) as { code?: string; type?: string };
        this.failure = new Error(`realtime error: ${e.code ?? e.type ?? "unknown"}`);
      }
      for (const w of [...this.waiters]) w(ev);
    });
    ws.on("close", () => {
      this.failure ??= new Error("realtime socket closed");
      for (const w of [...this.waiters]) w({ type: "socket.closed" });
    });
  }

  /** `baseUrl` is a test seam; it defaults to the real Realtime endpoint. */
  static async open(
    apiKey: string,
    model: string,
    baseUrl = "wss://api.openai.com/v1/realtime",
  ): Promise<RealtimeText> {
    const ws = new WebSocket(`${baseUrl}?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(new Error(`websocket failed: ${e.message}`)));
    });
    const session = new RealtimeText(ws);
    const { audio, ...base } = sessionConfig({ model, voice: "marin" });
    void audio; // text output replaces the audio block
    session.send({ type: "session.update", session: { ...base, output_modalities: ["text"] } });
    await session.next((e) => e.type === "session.updated");
    return session;
  }

  close() {
    this.ws.close();
  }

  private send(e: object) {
    this.ws.send(JSON.stringify(e));
  }

  private next(pred: (ev: Ev) => boolean): Promise<Ev> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(w);
        reject(new Error("eval timeout"));
      }, TIMEOUT_MS);
      const w = (ev: Ev) => {
        if (ev.type === "socket.closed" || (ev.type === "error" && this.failure)) {
          clearTimeout(timer);
          this.waiters.delete(w);
          return reject(this.failure ?? new Error("realtime failure"));
        }
        if (!pred(ev)) return;
        clearTimeout(timer);
        this.waiters.delete(w);
        resolve(ev);
      };
      this.waiters.add(w);
    });
  }

  private addItem(item: Record<string, unknown>) {
    this.send({ type: "conversation.item.create", item });
  }

  /** Replaces the "listener is on slide" note (one at a time, so context stays small). */
  setSlide(slide: SlideId) {
    this.slide = slide;
    if (this.slideNoteId) this.deleteItems([this.slideNoteId]);
    this.slideNoteId = newId("note");
    this.addItem({
      id: this.slideNoteId,
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: `The listener is on slide "${slide}".` }],
    });
  }

  addNote(text: string): string {
    const id = newId("note");
    this.addItem({
      id,
      type: "message",
      role: "system",
      content: [{ type: "input_text", text }],
    });
    return id;
  }

  deleteItems(ids: string[]) {
    for (const item_id of ids) this.send({ type: "conversation.item.delete", item_id });
  }

  private addUser(text: string): string {
    const id = newId("user");
    this.addItem({ id, type: "message", role: "user", content: [{ type: "input_text", text }] });
    return id;
  }

  /**
   * A `failed` response (e.g. a rate limit during a long run) adds nothing to the conversation, so
   * it is retried with backoff; the reason is kept so a persistent failure says why.
   */
  private async response(): Promise<{
    output: Record<string, unknown>[];
    status: string;
    tokens: number | null;
  }> {
    for (let attempt = 0; ; attempt++) {
      const r = await this.responseOnce();
      if (!r.status.startsWith("failed") || attempt >= RETRY_DELAYS_MS.length) return r;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  private async responseOnce(): Promise<{
    output: Record<string, unknown>[];
    status: string;
    tokens: number | null;
  }> {
    this.send({ type: "response.create", response: { instructions: answerReanchor() } });
    const done = await this.next((e) => e.type === "response.done");
    const r = (done["response"] ?? {}) as {
      output?: Record<string, unknown>[];
      status?: string;
      usage?: { total_tokens?: number };
      status_details?: { type?: string; reason?: string; error?: { code?: string; type?: string } };
    };
    const d = r.status_details;
    const why = [d?.type, d?.reason, d?.error?.code ?? d?.error?.type].filter(Boolean).join(", ");
    return {
      output: r.output ?? [],
      status: why ? `${r.status ?? "unknown"} (${why})` : (r.status ?? "unknown"),
      tokens: r.usage?.total_tokens ?? null,
    };
  }

  /** One user question, with the controller's tool loop (arch §4.3, §5.5). */
  async ask(question: string): Promise<TurnOutcome> {
    const userItemId = this.addUser(question);
    const itemIds = [userItemId];
    const tools: ToolCallRecord[] = [];
    let text = "";
    let preamble = "";
    let totalTokens: number | null = null;

    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const r = await this.response();
      if (r.status !== "completed") throw new Error(`response ${r.status}`);
      totalTokens = r.tokens ?? totalTokens;
      const calls = r.output.filter((o) => o["type"] === "function_call");
      let said = "";
      for (const o of r.output) {
        if (typeof o["id"] === "string") itemIds.push(o["id"]);
        if (o["type"] !== "message") continue;
        for (const c of (o["content"] ?? []) as { text?: string; transcript?: string }[]) {
          said += ` ${c.text ?? c.transcript ?? ""}`;
        }
      }
      text += said;
      if (calls.length > 0) preamble += said;
      if (calls.length === 0) break;
      let needsContinuation = false;
      for (const call of calls) {
        let args: unknown = {};
        try {
          args = JSON.parse(String(call["arguments"] || "{}"));
        } catch {
          args = {};
        }
        const name = String(call["name"]);
        tools.push({ name, args });
        let output: Record<string, unknown> = { ok: true };
        if (name === "goto_slide") {
          const a = args as { slide_id?: unknown; intent?: unknown };
          if (isSlide(a.slide_id)) {
            if (a.intent !== "stay") this.slide = a.slide_id;
            output = { ok: true, slide_title: slideById(a.slide_id).title };
          } else output = { ok: false, error: "unknown slide_id" };
          needsContinuation = true;
        } else if (name !== "resume_presentation") output = { ok: false, error: "unknown tool" };
        const id = newId("out");
        itemIds.push(id);
        this.addItem({
          id,
          type: "function_call_output",
          call_id: String(call["call_id"]),
          output: JSON.stringify(output),
        });
      }
      // resume_presentation ends the turn without a spoken continuation.
      if (!needsContinuation) break;
    }
    return {
      text: text.trim(),
      tools,
      preamble: preamble.trim(),
      itemIds,
      userItemId,
      totalTokens,
      slide: this.slide,
    };
  }

  /** A question whose answer is cut off at once (an interrupt), with the fragments deleted. */
  async askAndCancel(question: string): Promise<void> {
    const userItemId = this.addUser(question);
    this.send({ type: "response.create", response: { instructions: answerReanchor() } });
    const created = await this.next((e) => e.type === "response.created");
    const id = ((created["response"] ?? {}) as { id?: string }).id;
    this.send({ type: "response.cancel", ...(id ? { response_id: id } : {}) });
    const done = await this.next((e) => e.type === "response.done");
    const out = ((done["response"] ?? {}) as { output?: { id?: string }[] }).output ?? [];
    // Cancelled fragments are deleted, never left half-said (arch §5.10).
    this.deleteItems([userItemId, ...out.flatMap((o) => (o.id ? [o.id] : []))]);
  }
}

/** One question on a fresh session with the listener on `slide` (the golden-set runner). */
export async function askOnce(
  question: string,
  slide: SlideId,
  apiKey: string,
  model: string,
  baseUrl?: string,
): Promise<EvalResult> {
  const session = await RealtimeText.open(apiKey, model, baseUrl);
  try {
    session.setSlide(slide);
    const { text, tools, preamble } = await session.ask(question);
    return { text, tools, preamble };
  } finally {
    session.close();
  }
}
