import { DEFAULT_PERSONA, personaById, slideById, type PersonaId } from "@ava/shared";
import {
  newItemId,
  type GenerationStatus,
  type Usage,
  type ResponseRequest,
  type ToolName,
  type VoiceEvent,
  type VoiceEventBody,
  type VoiceSession,
  VoiceError,
} from "../types.js";

export type FakeCommand =
  | { type: "connect"; hasMic: boolean }
  | { type: "close" }
  | { type: "createResponse"; req: ResponseRequest }
  | { type: "sendUserText"; text: string; itemId: string }
  | { type: "addAssistantText"; text: string }
  | { type: "sendToolResult"; callId: string; output: unknown; itemId: string }
  | { type: "interrupt" }
  | { type: "beginUserTurn"; turnId: string }
  | { type: "endUserTurn"; cancel: boolean }
  | { type: "addControllerNote"; text: string; itemId: string }
  | { type: "deleteItems"; ids: string[] }
  | { type: "setMicEnabled"; enabled: boolean }
  | { type: "setTurnMode"; mode: "tapToTalk" | "handsFree" }
  | { type: "replaceMic" }
  | { type: "setOutputGain"; gain: 0 | 1 };

interface FakeResponse {
  req: ResponseRequest;
  responseId: string;
  generating: boolean;
  playing: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

export interface FakeOptions {
  epoch?: number;
  /** Plays every request through with canned timings (e2e). */
  auto?: boolean;
  /** Auto mode: milliseconds of "audio" per character of spoken text. */
  msPerChar?: number;
  /** connect() fails instead of connecting. */
  failConnect?: boolean;
  /** connect() takes this long, so tests can observe "Connecting…" / "reconnecting…". */
  connectDelayMs?: number;
  /** The presenter the controller asked for; the greeting names them. */
  persona?: PersonaId;
}

/** Canned lines for auto mode. Production never bundles this file (scripts/check-bundle-secrets.mjs). */
const greetingLine = (persona: PersonaId) =>
  `Hi, I'm ${personaById(persona).name}. I'll walk you through how GLP-1 medicines work, and you can interrupt me anytime.`;
const DEFAULT_ANSWER = "Good question. Here's the short answer from the reviewed deck.";

/**
 * Deterministic VoiceSession for unit tests (manual drivers) and Playwright (auto mode).
 * Records every command; the drivers emit the events a real adapter would.
 */
export class FakeVoiceSession implements VoiceSession {
  /** Bundle marker: must never appear in a production build. */
  static readonly marker = "ava-fake-voice-session";
  readonly epoch: number;
  readonly sessionId: string | null = null;
  readonly commands: FakeCommand[] = [];
  gain: 0 | 1 = 1;
  micEnabled = false;
  closed = false;
  /** Auto mode: what the fake "hears" when a voice turn is committed. */
  nextTranscript = "Can you say more about that?";

  private listeners = new Set<(e: VoiceEvent) => void>();
  private responses = new Map<string, FakeResponse>();
  private counter = 0;
  private pendingInterrupt: { resolve: (r: "cleared" | "timeout") => void } | null = null;
  private interruptPromise: Promise<"cleared" | "timeout"> | null = null;
  /** Requests in flight when interrupt() was called; only these are cancelled by ackInterrupt(). */
  private interrupted = new Set<string>();
  private pendingCommit: ((r: { committed: boolean; itemId?: string }) => void) | null = null;
  private hasSender = false;
  private lastUserText = "";
  private turnId: string | null = null;
  private opts: Required<Omit<FakeOptions, "epoch">>;

  constructor(opts: FakeOptions = {}) {
    this.epoch = opts.epoch ?? 1;
    this.opts = {
      auto: false,
      msPerChar: 6,
      failConnect: false,
      connectDelayMs: 0,
      persona: DEFAULT_PERSONA,
      ...opts,
    };
  }

  // ---- VoiceSession ----

  async connect({ mic }: { mic: MediaStream | null; signal?: AbortSignal }) {
    this.commands.push({ type: "connect", hasMic: mic !== null });
    this.hasSender = mic !== null;
    if (this.opts.connectDelayMs) await new Promise((r) => setTimeout(r, this.opts.connectDelayMs));
    if (this.closed) throw new Error("fake closed during connect");
    if (this.opts.failConnect) throw new Error("fake connect failure");
    this.emit({ type: "connected" });
  }

  close() {
    if (this.closed) return;
    this.commands.push({ type: "close" });
    for (const r of this.responses.values()) r.timers.forEach(clearTimeout);
    this.pendingInterrupt?.resolve("cleared");
    this.pendingCommit?.({ committed: false });
    this.closed = true;
    this.listeners.clear();
  }

  on(listener: (e: VoiceEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  createResponse(req: ResponseRequest) {
    this.commands.push({ type: "createResponse", req });
    const r: FakeResponse = {
      req,
      responseId: `resp_${++this.counter}`,
      generating: true,
      playing: false,
      timers: [],
    };
    this.responses.set(req.requestId, r);
    if (this.opts.auto) this.autoPlay(r);
  }

  sendUserText(text: string) {
    const itemId = newItemId("user");
    this.lastUserText = text;
    this.commands.push({ type: "sendUserText", text, itemId });
    return itemId;
  }

  addAssistantText(text: string) {
    this.commands.push({ type: "addAssistantText", text });
  }

  sendToolResult(callId: string, output: unknown) {
    const itemId = newItemId("out");
    this.commands.push({ type: "sendToolResult", callId, output, itemId });
    return itemId;
  }

  interrupt(): Promise<"cleared" | "timeout"> {
    this.commands.push({ type: "interrupt" });
    this.gain = 0;
    for (const [id, r] of this.responses) if (r.generating || r.playing) this.interrupted.add(id);
    if (this.interruptPromise) return this.interruptPromise;
    if (!this.isActive()) return Promise.resolve("cleared");
    const p = new Promise<"cleared" | "timeout">((resolve) => {
      const timer = setTimeout(() => finish("timeout"), 1500);
      const finish = (r: "cleared" | "timeout") => {
        clearTimeout(timer);
        this.pendingInterrupt = null;
        this.interruptPromise = null;
        resolve(r);
      };
      this.pendingInterrupt = { resolve: finish };
    });
    this.interruptPromise = p;
    if (this.opts.auto) setTimeout(() => this.ackInterrupt(), 20);
    return p;
  }

  beginUserTurn(turnId: string) {
    this.commands.push({ type: "beginUserTurn", turnId });
    this.turnId = turnId;
    void this.interrupt();
    this.micEnabled = true;
  }

  endUserTurn({ cancel }: { cancel: boolean }): Promise<{ committed: boolean; itemId?: string }> {
    this.commands.push({ type: "endUserTurn", cancel });
    this.pendingCommit?.({ committed: false });
    this.pendingCommit = null;
    if (cancel) {
      this.micEnabled = false;
      return Promise.resolve({ committed: false });
    }
    return new Promise((resolve) => {
      this.pendingCommit = (r) => {
        this.pendingCommit = null;
        this.micEnabled = false;
        resolve(r);
      };
      if (this.opts.auto) {
        setTimeout(() => {
          const itemId = newItemId("user");
          this.lastUserText = this.nextTranscript;
          this.userCommitted(itemId);
          setTimeout(() => this.userTranscript(itemId, this.nextTranscript), 80);
        }, 150);
      }
    });
  }

  addControllerNote(text: string) {
    const itemId = newItemId("note");
    this.commands.push({ type: "addControllerNote", text, itemId });
    return Promise.resolve(itemId);
  }

  deleteItems(ids: string[]) {
    this.commands.push({ type: "deleteItems", ids });
  }

  setMicEnabled(enabled: boolean) {
    this.micEnabled = enabled;
    this.commands.push({ type: "setMicEnabled", enabled });
  }

  setTurnMode(mode: "tapToTalk" | "handsFree") {
    this.commands.push({ type: "setTurnMode", mode });
  }

  async replaceMic() {
    this.commands.push({ type: "replaceMic" });
    if (!this.hasSender) throw new VoiceError("no_sender");
  }

  setOutputGain(gain: 0 | 1) {
    this.gain = gain;
    this.commands.push({ type: "setOutputGain", gain });
  }

  outputLevel() {
    return [...this.responses.values()].some((r) => r.playing) ? 0.5 * this.gain : 0;
  }

  // ---- test drivers ----

  responseId(requestId: string) {
    return this.responses.get(requestId)?.responseId ?? `resp_unknown_${requestId}`;
  }

  generationStarted(requestId: string) {
    this.emit({ type: "generation_started", requestId, responseId: this.responseId(requestId) });
  }

  generationDone(
    requestId: string,
    status: GenerationStatus = "completed",
    {
      hadAudio = true,
      outputItemIds = [] as string[],
      usage,
    }: { hadAudio?: boolean; outputItemIds?: string[]; usage?: Usage } = {},
  ) {
    const r = this.responses.get(requestId);
    if (r) r.generating = false;
    this.emit({
      type: "generation_done",
      requestId,
      responseId: this.responseId(requestId),
      status,
      hadAudio,
      outputItemIds,
      ...(usage ? { usage } : {}),
    });
    this.settleInterrupt();
  }

  playbackStarted(requestId: string) {
    const r = this.responses.get(requestId);
    if (r) r.playing = true;
    this.emit({ type: "playback_started", responseId: this.responseId(requestId) });
  }

  playbackCompleted(requestId: string) {
    const r = this.responses.get(requestId);
    if (r) r.playing = false;
    this.emit({ type: "playback_completed", responseId: this.responseId(requestId) });
    this.settleInterrupt();
  }

  playbackCleared(requestId: string) {
    const r = this.responses.get(requestId);
    if (r) r.playing = false;
    this.emit({ type: "playback_cleared", responseId: this.responseId(requestId) });
    this.settleInterrupt();
  }

  agentSays(requestId: string, text: string) {
    const responseId = this.responseId(requestId);
    this.emit({ type: "agent_transcript", responseId, delta: text, final: false });
    this.emit({ type: "agent_transcript", responseId, delta: "", final: true });
  }

  toolCall(requestId: string, callId: string, name: ToolName | string, args: unknown) {
    this.emit({
      type: "tool_call",
      requestId,
      responseId: this.responseId(requestId),
      callId,
      name: name as ToolName,
      args,
    });
  }

  userCommitted(itemId: string) {
    this.emit({ type: "user_input_committed", turnId: this.turnId ?? "", itemId });
    this.pendingCommit?.({ committed: true, itemId });
  }

  /** A committed but empty turn. */
  userEmpty() {
    this.pendingCommit?.({ committed: false });
  }

  userTranscript(itemId: string, text: string, final = true) {
    this.emit({ type: "user_transcript", itemId, text, final });
  }

  /** Acknowledge an interrupt: generation that was active ends cancelled, its audio is cleared. */
  ackInterrupt() {
    const targets = this.interrupted;
    this.interrupted = new Set();
    for (const [requestId, r] of this.responses) {
      if (!targets.has(requestId) || (!r.generating && !r.playing)) continue;
      r.timers.forEach(clearTimeout);
      r.timers = [];
      if (r.generating) {
        r.generating = false;
        this.emit({
          type: "generation_done",
          requestId,
          responseId: r.responseId,
          status: "cancelled",
          hadAudio: r.playing,
          outputItemIds: [],
        });
      }
      if (r.playing) {
        r.playing = false;
        this.emit({ type: "playback_cleared", responseId: r.responseId });
      }
    }
    this.pendingInterrupt?.resolve("cleared");
  }

  drop(reason: "network" | "server" = "network") {
    this.emit({ type: "disconnected", reason });
  }

  micEnded() {
    this.emit({ type: "mic_ended" });
  }

  /** Emits an event from the previous epoch, which the controller must ignore. */
  emitStale(body: VoiceEventBody) {
    const e = { ...body, sessionEpoch: this.epoch - 1 } as VoiceEvent;
    for (const l of [...this.listeners]) l(e);
  }

  toolResults(callId: string) {
    return this.commands.filter(
      (c): c is Extract<FakeCommand, { type: "sendToolResult" }> =>
        c.type === "sendToolResult" && c.callId === callId,
    );
  }

  creates() {
    return this.commands
      .filter(
        (c): c is Extract<FakeCommand, { type: "createResponse" }> => c.type === "createResponse",
      )
      .map((c) => c.req);
  }

  // ---- internals ----

  private emit(body: VoiceEventBody) {
    if (this.closed) return;
    const e = { ...body, sessionEpoch: this.epoch } as VoiceEvent;
    for (const l of [...this.listeners]) l(e);
  }

  private isActive() {
    return [...this.responses.values()].some((r) => r.generating || r.playing);
  }

  private settleInterrupt() {
    if (!this.pendingInterrupt) return;
    const busy = [...this.interrupted].some((id) => {
      const r = this.responses.get(id);
      return r && (r.generating || r.playing);
    });
    if (!busy) {
      this.interrupted.clear();
      this.pendingInterrupt.resolve("cleared");
    }
  }

  private at(r: FakeResponse, ms: number, fn: () => void) {
    r.timers.push(setTimeout(() => !this.closed && fn(), ms));
  }

  /** Auto mode: a tiny canned "model" for e2e. Navigation phrases map to tool calls. */
  private autoPlay(r: FakeResponse) {
    const { req } = r;
    const id = req.requestId;
    this.at(r, 25, () => this.generationStarted(id));

    if (req.kind === "answer") {
      const q = this.lastUserText.toLowerCase();
      const tool = /side effect|safety/.test(q)
        ? { name: "goto_slide", args: { slide_id: "safety", intent: "answer" } }
        : /evidence slide/.test(q)
          ? { name: "goto_slide", args: { slide_id: "evidence", intent: "user_request" } }
          : /^(go on|continue|mm-hm)/.test(q)
            ? { name: "resume_presentation", args: {} }
            : null;
      if (tool) {
        this.at(r, 60, () => this.toolCall(id, `call_${r.responseId}`, tool.name, tool.args));
        this.at(r, 80, () => this.generationDone(id, "completed", { hadAudio: false }));
        return;
      }
    }

    const text =
      req.kind === "greeting"
        ? greetingLine(this.opts.persona)
        : req.kind === "narration" && req.slideId !== undefined
          ? (slideById(req.slideId).segments[req.sentenceIndex ?? 0]?.text ?? "")
          : req.kind === "continuation" && /side effect/.test(this.lastUserText.toLowerCase())
            ? (slideById("safety").segments[0]?.text ?? DEFAULT_ANSWER)
            : DEFAULT_ANSWER;
    const duration = Math.max(300, text.length * this.opts.msPerChar);
    this.at(r, 40, () => {
      r.playing = true;
      this.emit({ type: "playback_started", responseId: r.responseId });
      this.emit({ type: "agent_transcript", responseId: r.responseId, delta: text, final: false });
    });
    this.at(r, 70, () => {
      this.emit({ type: "agent_transcript", responseId: r.responseId, delta: "", final: true });
      this.generationDone(id, "completed", { hadAudio: true });
    });
    this.at(r, 40 + duration, () => this.playbackCompleted(id));
  }
}
