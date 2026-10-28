import { greetingLine, slideById, type SlideId } from "@ava/shared";
import type { ApiResult, ChatAnswer, ChatInput } from "../../api/client.js";
import {
  newItemId,
  VoiceError,
  type ResponseRequest,
  type VoiceEvent,
  type VoiceEventBody,
  type VoiceSession,
} from "../types.js";

/** The slice of `speechSynthesis` the adapter uses, so tests can stub it. */
export interface SpeechLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export interface FallbackContext {
  displayedSlide(): SlideId;
  /** Completed question and answer pairs, oldest first. */
  history(): { q: string; a: string }[];
}

export interface FallbackDeps {
  /** `backup`: voice service down, backend up. `local`: offline, so only on-device voices (arch §6.5). */
  mode: "backup" | "local";
  speech: SpeechLike | null;
  makeUtterance(text: string): SpeechSynthesisUtterance;
  /** Absent offline: there are no answers without the backend. */
  chat?: (input: ChatInput) => Promise<ApiResult<ChatAnswer>>;
  context: FallbackContext;
}

type Stage = "pending" | "generating" | "speaking" | "done";

interface Active {
  req: ResponseRequest;
  responseId: string;
  stage: Stage;
  cancelled: boolean;
  /** The generation_done event has been emitted. */
  generated: boolean;
  /** Speech was queued, so a playback event is owed. */
  audio: boolean;
  abort: AbortController | null;
}

/**
 * Backup voice and offline narration (arch §4.2, §6.4–6.5). Implements VoiceSession over the
 * browser's speech engine: narration speaks the sentence script directly, answers come from
 * /api/chat and are validated by the server, then spoken. Like every adapter it only executes
 * commands and normalizes events; the controller still decides everything.
 */
export class FallbackSpeechSession implements VoiceSession {
  readonly sessionId = null;
  readonly selfContained = true;
  private listeners = new Set<(e: VoiceEvent) => void>();
  private active = new Map<string, Active>();
  private counter = 0;
  private closed = false;
  private broken = false;
  private lastUserText = "";

  constructor(
    readonly epoch: number,
    private deps: FallbackDeps,
  ) {}

  canSpeak() {
    const { speech, mode } = this.deps;
    if (!speech || this.broken) return false;
    return mode === "backup" || speech.getVoices().some((v) => v.localService);
  }

  async connect() {
    this.emit({ type: "connected" });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const a of this.active.values()) {
      a.cancelled = true;
      a.abort?.abort();
    }
    this.active.clear();
    this.deps.speech?.cancel();
    this.listeners.clear();
  }

  on(listener: (e: VoiceEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  createResponse(req: ResponseRequest) {
    if (this.closed) return;
    const a: Active = {
      req,
      responseId: `fb_${this.epoch}_${++this.counter}`,
      stage: "pending",
      cancelled: false,
      generated: false,
      audio: false,
      abort: null,
    };
    this.active.set(req.requestId, a);
    // Events never arrive inside the call that caused them.
    queueMicrotask(() => void this.run(a));
  }

  sendUserText(text: string) {
    this.lastUserText = text;
    return newItemId("user");
  }

  addAssistantText() {}

  sendToolResult() {
    return newItemId("out");
  }

  interrupt(): Promise<"cleared" | "timeout"> {
    const events: VoiceEventBody[] = [];
    for (const a of this.active.values()) {
      if (a.stage === "done") continue;
      a.cancelled = true;
      a.abort?.abort();
      if (!a.generated) {
        a.generated = true;
        events.push({
          type: "generation_done",
          requestId: a.req.requestId,
          responseId: a.responseId,
          status: "cancelled",
          hadAudio: false,
        });
      }
      if (a.audio) events.push({ type: "playback_cleared", responseId: a.responseId });
      a.stage = "done";
    }
    this.deps.speech?.cancel();
    // Acknowledgements arrive after the call returns, like a transport's would: the controller
    // must not be re-entered while it is still cancelling.
    return new Promise((resolve) =>
      queueMicrotask(() => {
        for (const e of events) this.emit(e);
        resolve("cleared");
      }),
    );
  }

  beginUserTurn() {}

  endUserTurn() {
    return Promise.resolve({ committed: false });
  }

  addControllerNote() {
    return Promise.resolve(newItemId("note"));
  }

  deleteItems() {}
  setMicEnabled() {}
  setTurnMode() {}

  async replaceMic(): Promise<void> {
    throw new VoiceError("no_sender");
  }

  setOutputGain(gain: 0 | 1) {
    if (gain === 0) this.deps.speech?.cancel();
  }

  outputLevel() {
    return [...this.active.values()].some((a) => a.stage === "speaking") ? 0.3 : 0;
  }

  // ---- internals ----

  private async run(a: Active) {
    if (a.cancelled || this.closed) return;
    const { req } = a;
    a.stage = "generating";
    this.emit({ type: "generation_started", requestId: req.requestId, responseId: a.responseId });

    if (req.kind === "greeting") return this.speak(a, greetingLine({ textOnly: true }), true);
    if (req.kind === "narration") return this.speak(a, this.narrationText(req), true);
    return this.answer(a);
  }

  private narrationText(req: ResponseRequest) {
    const slide = slideById(req.slideId ?? "intro");
    const sentence = slide.segments[req.sentenceIndex ?? 0]?.text ?? "";
    const lead =
      req.bridge === "return"
        ? `Back to where we were — ${slide.title}.`
        : req.bridge === "reconnect"
          ? "We're back."
          : "";
    return lead ? `${lead} ${sentence}` : sentence;
  }

  private async answer(a: Active) {
    const { chat, context } = this.deps;
    if (!chat) return this.generationDone(a, "failed", false);
    const abort = (a.abort = new AbortController());
    const history = context.history().slice(-6);
    const res = await chat({
      question: this.lastUserText,
      slideId: context.displayedSlide(),
      history: history.map((h) => ({ q: h.q.slice(0, 500), a: h.a.slice(0, 1500) })),
    }).catch(() => ({ ok: false as const, code: "backend_unreachable" as const }));
    if (a.cancelled || abort.signal.aborted || this.closed) return;
    if (!res.ok) return this.generationDone(a, "failed", false);

    const { answer, goto_slide, resume } = res.data;
    // Same controller paths as live tool calls (arch §6.4): navigation lands before the answer.
    if (goto_slide) {
      this.emit({
        type: "tool_call",
        requestId: a.req.requestId,
        responseId: a.responseId,
        callId: `${a.responseId}_goto`,
        name: "goto_slide",
        args: goto_slide,
      });
    }
    if (resume) {
      this.emit({
        type: "tool_call",
        requestId: a.req.requestId,
        responseId: a.responseId,
        callId: `${a.responseId}_resume`,
        name: "resume_presentation",
        args: {},
      });
    }
    this.speak(a, answer, false);
  }

  /** Narration captions follow playback; an answer is shown at once because it is always readable. */
  private speak(a: Active, text: string, captionOnStart: boolean) {
    const { speech } = this.deps;
    const caption = () =>
      this.emit({ type: "agent_transcript", responseId: a.responseId, delta: text, final: false });
    const finalCaption = () =>
      this.emit({ type: "agent_transcript", responseId: a.responseId, delta: "", final: true });

    if (!speech || !this.canSpeak()) {
      caption();
      finalCaption();
      return this.generationDone(a, "completed", false);
    }
    a.audio = true;
    if (!captionOnStart) caption();
    const fail = () => {
      if (a.cancelled || this.closed) return;
      // A real failure, not an interruption (interrupt() marks the response cancelled first).
      this.broken = true;
      a.stage = "done";
      if (captionOnStart) caption();
      finalCaption();
      this.emit({ type: "audio_unavailable" });
      this.emit({ type: "playback_cleared", responseId: a.responseId });
    };
    const u = this.deps.makeUtterance(text);
    u.lang = "en-US";
    u.onstart = () => {
      if (a.cancelled || this.closed) return;
      a.stage = "speaking";
      this.emit({ type: "playback_started", responseId: a.responseId });
      if (captionOnStart) caption();
    };
    u.onend = () => {
      if (a.cancelled || this.closed) return;
      a.stage = "done";
      finalCaption();
      this.emit({ type: "playback_completed", responseId: a.responseId });
    };
    u.onerror = fail;
    this.generationDone(a, "completed", true);
    try {
      if (this.deps.mode === "local") {
        const voice = speech.getVoices().find((v) => v.localService);
        if (voice) u.voice = voice;
      }
      speech.speak(u);
    } catch {
      fail(); // an engine that throws is an engine that cannot speak
    }
  }

  private generationDone(
    a: Active,
    status: "completed" | "cancelled" | "failed",
    hadAudio: boolean,
  ) {
    if (a.generated) return;
    a.generated = true;
    if (!hadAudio) a.stage = "done";
    this.emit({
      type: "generation_done",
      requestId: a.req.requestId,
      responseId: a.responseId,
      status,
      hadAudio,
    });
  }

  private emit(body: VoiceEventBody) {
    if (this.closed) return;
    const e = { ...body, sessionEpoch: this.epoch } as VoiceEvent;
    for (const l of [...this.listeners]) l(e);
  }
}
