import type { ResponseKind } from "../voice/types.js";

export interface RequestRecord {
  requestId: string;
  epoch: number;
  turnId: string | null;
  kind: ResponseKind;
  responseId?: string;
  generation: "pending" | "active" | "cancelling" | "done";
  /** Set when the request was invalidated; survives the move to "done". */
  cancelled: boolean;
  playback: "none" | "playing" | "completed" | "cleared";
  hadAudio: boolean;
  outputItemIds: string[];
  toolCalls: Map<string, { name: string; replied: boolean }>;
  /** Narration only. */
  slideId?: string;
  sentenceIndex?: number;
}

/** Requests and responses within one epoch (arch §4.4). */
export class Registry {
  epoch = 0;
  private byRequest = new Map<string, RequestRecord>();
  private byResponse = new Map<string, string>();

  bumpEpoch() {
    this.epoch++;
    this.byRequest.clear();
    this.byResponse.clear();
    return this.epoch;
  }

  isCurrent(e: { sessionEpoch: number }) {
    return e.sessionEpoch === this.epoch;
  }

  reserve(
    r: Pick<RequestRecord, "requestId" | "turnId" | "kind"> &
      Partial<Pick<RequestRecord, "slideId" | "sentenceIndex">>,
  ): RequestRecord {
    const rec: RequestRecord = {
      ...r,
      epoch: this.epoch,
      generation: "pending",
      cancelled: false,
      playback: "none",
      hadAudio: false,
      outputItemIds: [],
      toolCalls: new Map(),
    };
    this.byRequest.set(rec.requestId, rec);
    return rec;
  }

  attach(requestId: string, responseId: string) {
    const r = this.byRequest.get(requestId);
    if (r) {
      r.responseId = responseId;
      this.byResponse.set(responseId, requestId);
    }
    return r;
  }

  get(requestId: string) {
    return this.byRequest.get(requestId);
  }

  byResponseId(id: string) {
    const q = this.byResponse.get(id);
    return q ? this.byRequest.get(q) : undefined;
  }

  /** The generation slot: pending creation included. */
  generating() {
    return [...this.byRequest.values()].find((r) => r.generation !== "done");
  }

  playing() {
    return [...this.byRequest.values()].find((r) => r.playback === "playing");
  }

  /** Invalidate every request that hasn't finished generating or playing. */
  cancelInFlight() {
    for (const r of this.byRequest.values()) {
      const live = r.generation !== "done" || r.playback === "playing";
      if (!live) continue;
      r.cancelled = true;
      if (r.generation !== "done") r.generation = "cancelling";
    }
  }
}

/** Generation finished and its audio, if any, has finished playing or was cleared. */
export const audioSettled = (r: RequestRecord) =>
  r.generation === "done" &&
  (r.playback === "completed" ||
    r.playback === "cleared" ||
    (r.playback === "none" && !r.hadAudio));
