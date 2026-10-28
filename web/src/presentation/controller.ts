import {
  answerReanchor,
  deck,
  endOfferInstructions,
  GotoSlideArgs,
  greetingInstructions,
  narrationInstructions,
  slideById,
  SLIDE_IDS,
  type SlideId,
} from "@ava/shared";
import { createActor } from "xstate";
import {
  controlsOf,
  screenOf,
  sessionMachine,
  toStatusSnapshot,
  type Controls,
  type SessionEvent,
} from "../machine/session.js";
import {
  ERROR_ACTIONS,
  orbState,
  statusLabel,
  type ErrorCode,
  type OrbState,
  type StatusSnapshot,
  type Tone,
} from "../machine/status.js";
import {
  VoiceError,
  type ResponseKind,
  type ResponseRequest,
  type VoiceErrorCode,
  type VoiceEvent,
  type VoiceSession,
} from "../voice/types.js";
import type { FallbackContext } from "../voice/fallback/FallbackSpeechSession.js";
import { CaptionLog, narrationOverrun, type CaptionLine } from "./captions.js";
import { isEndCommand } from "./endCommand.js";
import {
  answerNavigate,
  ask,
  explicitNavigate,
  indexOf,
  initialCtx,
  questionDone,
  sentencePlayed,
  setStatus,
  showCheckpoint,
  slideAt,
  stayHere,
  type Checkpoint,
  type PresentationCtx,
  type Status,
} from "./checkpoint.js";
import { createAudioProbe, type AudioProbe } from "../metrics/probe.js";
import { MetricsRecorder, type MetricName, type MetricSummary } from "../metrics/recorder.js";
import { SILENCE_RMS } from "../metrics/silence.js";
import { initialNotes, noteForPlayed, prunePlan, type NotesState } from "./notes.js";
import {
  connectWithRetry,
  restorePlan,
  seedVoice,
  type Qa,
  type RestorePlan,
  type Snapshot,
} from "./recovery.js";
import { audioSettled, Registry, type RequestRecord } from "./registry.js";
import { Timers, type Handle, type TimerScope } from "./timers.js";

/** Timer values (arch §4.6). */
export const TIMING = {
  accidentalMs: 300,
  orbTurnMs: 30_000,
  thinkingSlowMs: 4_000,
  thinkingTimeoutMs: 10_000,
  resumeWindowMs: 1_500,
} as const;

export type VoiceTarget = "live" | "backup" | "offline";

/** Replays of a question the adapter no longer has. */
export interface ControllerDeps {
  /** `reconnectOf` is the previous live session id, so the server reuses its slot (arch §6.3). */
  voiceFactory: (epoch: number, opts?: { reconnectOf?: string }) => VoiceSession;
  /** Backup voice (`backup`) and offline local speech (`local`), arch §6.4–6.5. */
  backupFactory?: (epoch: number, mode: "backup" | "local", ctx: FallbackContext) => VoiceSession;
  /** Timed reachability probe of /api/health; resolves false when the network is down. */
  probeHealth?: () => Promise<boolean>;
  schedule?: (fn: () => void, ms: number) => Handle;
  cancel?: (h: Handle) => void;
  now?: () => number;
  /** Fire-and-forget end beacon for the server slot (arch §6.6). */
  onEndSession?: (sessionId: string) => void;
  /** Receives the latency summary once on End, with the server session id (arch §7). */
  onMetrics?: (sessionId: string, metrics: Partial<Record<MetricName, MetricSummary>>) => void;
  metrics?: MetricsRecorder;
  debug?: (msg: string, data?: Record<string, unknown>) => void;
}

/** The first reply to "Try live voice again" or a restored connection waits for a boundary (arch §6.4). */
const PROBE_MS = 30_000;

type Bridge = "resume" | "return" | "reconnect";
type Phase = "greeting" | "narrating" | "awaitingResume" | "finished";
type TurnSource = "space" | "orb" | "typed" | "askAgain";

interface Turn {
  id: string;
  source: TurnSource;
  question: string | null;
  userItemId: string | null;
  startedAt: number;
  capturing: boolean;
  submitted: boolean;
  currentRequestId: string | null;
  pendingKind: "answer" | "continuation" | null;
  requestIds: string[];
  toolItemIds: string[];
  needsContinuation: boolean;
  resumeRequested: boolean;
  continuations: number;
  invalidTools: number;
  /** The answer this press interrupted, offered as Ask again if the press turns out accidental. */
  cutBefore: Cut | null;
  /** Slide sync (arch §7): first audible answer frame vs. the slide transition finishing. */
  firstSoundAt: number | null;
  slideChanged: boolean;
  slideDoneAt: number | null;
  /** offer_end: "requested" by the tool, then "offering" while the fixed offer line is spoken. */
  endOffer: "none" | "requested" | "offering";
}

/** An answer that was cut short; Ask again re-requests it for the same user item. */
interface Cut {
  question: string | null;
  userItemId: string;
  /** The conversation that held the item is gone (reconnect): the question text is sent again. */
  resend?: boolean;
}

export interface ControllerView {
  screen: "landing" | "micCheck" | "ready" | "live" | "ended";
  status: { label: string; tone: Tone };
  orb: OrbState;
  snapshot: StatusSnapshot;
  controls: Controls;
  displayedSlide: SlideId;
  slideIndex: number;
  checkpoint: Checkpoint;
  presentationStatus: Status;
  highlightBullet: number | null;
  captions: readonly CaptionLine[];
  showStayHere: boolean;
  askAgain: boolean;
  capturing: "space" | "orb" | null;
  typing: boolean;
  questions: string[];
  notice: string | null;
  /** Nothing can be spoken: the sentence scripts are shown instead (arch §6.4–6.5). */
  scriptMode: boolean;
  /** "Continue with backup voice" is offered (connection failed with a recoverable error). */
  canBackup: boolean;
  /** "Try live voice again" is offered (backup voice or offline). */
  canTryLive: boolean;
  /** "Try microphone again" is offered (text mode in a live session). */
  canTryMic: boolean;
  debug: {
    epoch: number;
    generating: string | null;
    playing: string | null;
    /** Narration transcripts much longer than their scripted sentence (detection only). */
    narrationOverruns: number;
  };
}

const VOICE_TO_ERROR: Partial<Record<VoiceErrorCode, ErrorCode>> = {
  not_configured: "not_configured",
  quota: "quota",
  demo_paused: "demo_paused",
  demo_busy: "demo_busy",
  quota_reached: "quota_reached",
  rate_limited: "rate_limited",
  bot_check_failed: "bot_check_failed",
  backend_unreachable: "backend_unreachable",
  server_error: "server_error",
};

/** Voice errors a retry cannot fix; the loop stops and the reviewer chooses (arch §6.2). */
const RETRYABLE = new Set<VoiceErrorCode>([
  "session_failed",
  "server_error",
  "backend_unreachable",
]);
const RETRYABLE_CODES = new Set<ErrorCode>([
  "session_failed",
  "server_error",
  "backend_unreachable",
]);

const AGENT_EVENT = {
  idle: "AGENT.IDLE",
  listening: "AGENT.LISTENING",
  thinking: "AGENT.THINKING",
  speaking: "AGENT.SPEAKING",
  paused: "AGENT.PAUSED",
  pausedTyping: "AGENT.PAUSED_TYPING",
} as const;

const PRESENTATION_EVENT = {
  greeting: "PRESENTATION.GREETING",
  narrating: "PRESENTATION.NARRATING",
  answering: "PRESENTATION.ANSWERING",
  awaitingResume: "PRESENTATION.AWAITING_RESUME",
  finished: "PRESENTATION.FINISHED",
} as const;

/**
 * The presentation controller (arch §4.3–4.7): the only caller of createResponse. It owns the
 * checkpoint context, the response registry and epochs, tool handling and timers, and mirrors its
 * state into the session machine.
 */
export class PresentationController {
  private ctx: PresentationCtx = initialCtx();
  private registry = new Registry();
  private timers: Timers;
  private actor = createActor(sessionMachine).start();
  private voice: VoiceSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private mic: MediaStream | null = null;
  private abort: AbortController | null = null;
  private turn: Turn | null = null;
  private turnBarrier: Promise<"cleared" | "timeout"> = Promise.resolve("cleared");
  private cut: Cut | null = null;
  private completedQA: Qa[] = [];
  private lastLiveSessionId: string | null = null;
  private everConnected = false;
  /** Invalidates an in-flight connect loop (End, a newer swap, offline). */
  private swapToken = 0;
  private attempting: VoiceSession | null = null;
  private sleepCancel: (() => void) | null = null;
  /** A connected live adapter waiting for a boundary to replace the backup voice. */
  private candidate: { voice: VoiceSession; dead: boolean } | null = null;
  private probing = false;
  private probeAbort: AbortController | null = null;
  private audioNone = false;
  /** The talk was paused because audio went away, not by the reviewer. */
  private forcedPause = false;
  private phase: Phase = "greeting";
  private greetingReq: string | null = null;
  private narrationReq: string | null = null;
  private pendingBridge: Bridge | undefined;
  private lastBridge: string | undefined;
  private bridges = new Map<string, Bridge>();
  private narrationOverruns = 0;
  /** User items whose final transcript was empty (confirmed silence or noise). */
  private silentItems = new Set<string>();
  private typing = false;
  private notice: string | null = null;
  private captions = new CaptionLog();
  private notes: NotesState = initialNotes();
  private questions: { id: string; text: string }[] = [];
  private listeners = new Set<() => void>();
  private cached: ControllerView;
  private sent = { agent: "", presentation: "" };
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => Handle;
  private cancelTimer: (h: Handle) => void;
  readonly metrics: MetricsRecorder;
  private probe: AudioProbe;
  private staleCount = 0;
  private convTokens: number | null = null;

  constructor(private deps: ControllerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.metrics = deps.metrics ?? new MetricsRecorder(this.now);
    this.probe = createAudioProbe({ level: () => this.voice?.outputLevel() ?? 0, now: this.now });
    this.timers = new Timers(
      { schedule: this.schedule, cancel: this.cancelTimer },
      (scope) =>
        scope.epoch === this.registry.epoch &&
        (scope.turnId === null || scope.turnId === this.turn?.id),
    );
    this.cached = this.buildView();
  }

  // ---- subscription ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  view = (): ControllerView => this.cached;

  /** Post-gate output level for the orb while Ava speaks. */
  outputLevel = () => this.voice?.outputLevel() ?? 0;

  /** Live numbers for the ?debug=1 overlay; not part of the view, so it never re-renders the app. */
  debugSnapshot = () => ({
    metrics: this.metrics.summary(),
    staleEvents: this.staleCount,
    conversationTokens: this.convTokens,
  });

  /** The slide transition finished painting (called by the stage). */
  slideTransitionDone() {
    const t = this.turn;
    if (!t?.slideChanged || t.slideDoneAt !== null) return;
    t.slideDoneAt = this.now();
    this.settleSlideSync(t);
  }

  /** Stops the named metrics at the first non-silent post-gate frame. */
  private armSound(...names: MetricName[]) {
    this.probe.onSound((at) => {
      for (const n of names) this.metrics.stop(n, at);
      const t = this.turn;
      // Turn metrics only count while the turn they belong to is still being answered.
      if (!t?.submitted) this.metrics.cancel("answerLatency", "typedLatency");
      else if (t.firstSoundAt === null) {
        t.firstSoundAt = at;
        this.settleSlideSync(t);
      }
    });
  }

  private settleSlideSync(t: Turn) {
    if (!t.slideChanged || t.firstSoundAt === null || t.slideDoneAt === null) return;
    t.slideChanged = false;
    // A slide that finished before the audio began was already in sync.
    this.metrics.record("slideSync", Math.max(0, t.slideDoneAt - t.firstSoundAt));
  }

  // ---- setup ----

  micCheck() {
    this.actor.send({ type: "SETUP.MIC_CHECK" });
    this.emit();
  }

  setupReady() {
    this.actor.send({ type: "SETUP.READY" });
    this.emit();
  }

  backToLanding() {
    this.actor.send({ type: "SETUP.BACK" });
    this.emit();
  }

  /** Start presentation: connect, then greet. The mic stream (if any) is shared from the mic check. */
  async start(mic: MediaStream | null = null) {
    if (!this.actor.getSnapshot().matches("setup")) return;
    this.mic = mic;
    this.actor.send({ type: "START", input: mic ? "voice" : "text" });
    const opening = this.open("live", { initial: true });
    // After open()'s synchronous teardown, which cancels in-flight metrics; still before connect.
    this.metrics.start("greeting");
    this.armSound("greeting");
    await opening;
  }

  // ---- turns ----

  talkDown(source: "space" | "orb" = "space") {
    if (!this.isLive()) return;
    if (this.turn?.capturing) return;
    if (!this.controls().talk) {
      const s = this.snapshot();
      this.notice =
        s.input === "text" || s.voice !== "live"
          ? "Voice input is off — type your question below."
          : "Hold on — the voice service isn't ready yet.";
      return this.emit();
    }
    const voice = this.voice!;
    // Barge-in: keydown (or first orb activation) until the post-gate output is silent.
    if (this.registry.playing() || voice.outputLevel() > SILENCE_RMS) {
      this.metrics.start("bargeIn");
      this.probe.onSilence((at) => this.metrics.stop("bargeIn", at));
    }
    const prev = this.turn;
    const cutBefore = prev?.submitted && prev.userItemId ? toCut(prev) : this.cut;
    this.typing = false;
    this.notice = null;
    this.ctx = ask(this.ctx);
    this.turnBarrier = this.interruptAll();
    this.cut = null;
    this.turn = this.newTurn(source, { capturing: true, cutBefore });
    this.timers.clear("thinkSlow", "thinkTimeout", "orb");
    this.setSlow(false);
    voice.beginUserTurn(this.turn.id);
    if (source === "orb") {
      this.timers.set("orb", TIMING.orbTurnMs, this.scope(), () => void this.sendCapture());
    }
    this.emit();
  }

  talkUp() {
    const t = this.turn;
    if (!t?.capturing || t.source !== "space") return;
    if (this.now() - t.startedAt < TIMING.accidentalMs) return this.cancelCapture("accidental");
    void this.sendCapture();
  }

  /** Orb taps toggle capture: the first starts, the second sends. No accidental-hold rule. */
  orbPress() {
    if (this.turn?.capturing) {
      if (this.turn.source === "orb") void this.sendCapture();
      return;
    }
    this.talkDown("orb");
  }

  orbCancel() {
    if (this.turn?.capturing) this.cancelCapture("escape");
  }

  focusLost() {
    if (this.turn?.capturing) this.cancelCapture("focusLost");
  }

  escape() {
    if (this.turn?.capturing) return this.cancelCapture("escape");
    if (this.cut) return this.dismissAskAgain();
    if (this.notice) {
      this.notice = null;
      this.emit();
    }
  }

  askTyped(text: string): Promise<void> {
    const question = text.trim();
    if (!question || !this.isLive()) return Promise.resolve();
    if (isEndCommand(question)) {
      this.debug("end_requested", { via: "typed" });
      this.end();
      return Promise.resolve();
    }
    if (!this.controls().ask) return Promise.resolve();
    const voice = this.voice!;
    if (this.turn?.capturing) void voice.endUserTurn({ cancel: true });
    this.typing = false;
    this.notice = null;
    this.clearAnswerError();
    this.ctx = ask(this.ctx);
    const barrier = this.interruptAll();
    this.cut = null;
    const t = (this.turn = this.newTurn("typed", { submitted: true, question }));
    t.userItemId = voice.sendUserText(question);
    this.metrics.start("typedLatency");
    this.armSound("typedLatency");
    this.captions.userTyped(t.userItemId, question);
    this.questions.push({ id: t.userItemId, text: question });
    this.startThinking();
    this.emit();
    void barrier.then((r) => {
      if (this.turn !== t) return;
      if (r === "timeout") return this.onInterruptTimeout();
      this.issueTurnRequest("answer");
      this.pump();
    });
    return Promise.resolve();
  }

  /** First keystroke in the question box: pause at once (brief §7.4). */
  typingStarted() {
    if (this.typing || !this.isLive()) return;
    this.typing = true;
    const t = this.turn;
    if (t?.capturing) return this.emit();
    if (t?.submitted && t.userItemId) this.cut = toCut(t);
    this.turn = null;
    this.interruptAll();
    this.timers.clear("thinkSlow", "thinkTimeout");
    this.setSlow(false);
    if (this.phase === "awaitingResume") this.phase = "narrating";
    this.emit();
  }

  /** The box was cleared: restore the pre-typing status. */
  typingCleared() {
    if (!this.typing) return;
    this.typing = false;
    this.pendingBridge = this.bridgeFor();
    this.pump();
  }

  askAgain() {
    const c = this.cut;
    if (!c || !this.isLive() || !this.voice) return;
    this.cut = null;
    this.clearAnswerError();
    this.ctx = ask(this.ctx);
    const barrier = this.interruptAll();
    const t = (this.turn = this.newTurn("askAgain", { submitted: true, question: c.question }));
    // After a reconnect the old item is gone with its conversation: the text is sent again.
    t.userItemId = c.resend ? this.voice.sendUserText(c.question ?? "") : c.userItemId;
    this.startThinking();
    this.emit();
    void barrier.then((r) => {
      if (this.turn !== t) return;
      if (r === "timeout") return this.onInterruptTimeout();
      this.issueTurnRequest("answer");
      this.pump();
    });
  }

  dismissAskAgain() {
    if (!this.cut) return;
    this.cut = null;
    this.clearAnswerError();
    this.afterQuestion(false);
    this.pump();
  }

  // ---- presentation controls ----

  togglePause() {
    if (!this.isLive()) return;
    if (this.ctx.status !== "running") return this.resume();
    if (this.turn?.capturing) void this.voice?.endUserTurn({ cancel: true });
    const t = this.turn;
    if (t?.submitted && t.userItemId) this.cut = toCut(t);
    this.turn = null;
    this.interruptAll();
    this.ctx = setStatus(this.ctx, "paused");
    this.forcedPause = false;
    this.timers.clear("resume", "thinkSlow", "thinkTimeout", "orb");
    this.setSlow(false);
    if (this.phase === "awaitingResume") this.phase = "narrating";
    this.emit();
  }

  /** Explicit Resume: running at the selected checkpoint (also after finished). */
  resume() {
    if (!this.isLive()) return;
    if (this.audioNone) {
      // Nothing can be spoken, so the talk stays paused and the script is the content.
      this.notice = "Audio unavailable — read the script below.";
      return this.emit();
    }
    this.forcedPause = false;
    if (this.turn?.submitted) {
      // The question finishes first, then the talk continues.
      this.ctx = setStatus(this.ctx, "running");
      return this.emit();
    }
    this.cut = null;
    this.clearAnswerError();
    this.ctx = { ...setStatus(this.ctx, "running"), preQuestion: null };
    if (this.phase !== "greeting") this.phase = "narrating";
    this.pendingBridge = this.bridgeFor();
    this.pump();
  }

  next() {
    const i = indexOf(this.ctx.displayedSlide);
    const to = slideAt(i + 1);
    if (to) this.navigate(to);
  }

  prev() {
    const i = indexOf(this.ctx.displayedSlide);
    const to = slideAt(i - 1);
    if (to) this.navigate(to);
  }

  goto(index: number) {
    const to = slideAt(index);
    if (to) this.navigate(to);
  }

  /** Arrows, 1–6, dots (arch §4.7): replace the checkpoint, keep the status, cancel obsolete work. */
  navigate(to: SlideId) {
    if (!this.isLive() || !this.controls().navigate) return;
    if (this.turn?.capturing) void this.voice?.endUserTurn({ cancel: true });
    const abandoned = this.turn !== null || this.cut !== null;
    this.turn = null;
    this.cut = null;
    this.interruptAll();
    this.timers.clear("resume", "thinkSlow", "thinkTimeout", "orb");
    this.setSlow(false);
    this.clearAnswerError();
    this.ctx = explicitNavigate(this.ctx, to);
    if (abandoned && this.ctx.preQuestion) {
      this.ctx = { ...this.ctx, status: this.ctx.preQuestion.status, preQuestion: null };
    }
    this.phase = this.ctx.status === "finished" ? "finished" : "narrating";
    this.pendingBridge = undefined;
    this.pump();
  }

  stayHere() {
    if (!this.isLive() || this.ctx.displayedSlide === this.ctx.checkpoint.slideId) return;
    this.ctx = stayHere(this.ctx);
    this.emit();
  }

  retry() {
    if (!this.isLive()) return;
    const err = this.snapshot().error;
    if ((err === "response_timeout" || err === "response_failed") && this.cut)
      return this.askAgain();
    if (this.snapshot().connection === "failed") return void this.open("live");
    this.clearError();
    this.pump();
  }

  dismissNotice() {
    this.notice = null;
    this.emit();
  }

  /** Immediate teardown (arch §6.6): nothing waits for the network. */
  end() {
    if (!this.isLive()) return;
    const sessionId = this.voice?.sessionId ?? this.lastLiveSessionId;
    // Report before teardown, which cancels in-flight metrics.
    if (sessionId) this.deps.onMetrics?.(sessionId, this.metrics.summary());
    this.teardown(); // invalidates the epoch first, then disposes; cancels any reconnect loop
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.typing = false;
    if (sessionId) this.deps.onEndSession?.(sessionId);
    this.actor.send({ type: "END" });
    this.emit();
  }

  /** Restart: a new session from slide 1, back through the landing screen. */
  restart() {
    if (this.isLive()) this.end();
    this.ctx = initialCtx();
    this.captions.clear();
    this.notes = initialNotes();
    this.questions = [];
    this.completedQA = [];
    this.lastLiveSessionId = null;
    this.everConnected = false;
    this.audioNone = false;
    this.forcedPause = false;
    this.phase = "greeting";
    this.pendingBridge = undefined;
    this.lastBridge = undefined;
    this.narrationOverruns = 0;
    this.notice = null;
    this.sent = { agent: "", presentation: "" };
    this.metrics.reset();
    this.staleCount = 0;
    this.convTokens = null;
    this.actor.send({ type: "RESTART" });
    this.emit();
  }

  // ---- connection and recovery (arch §6) ----

  /**
   * Opens a voice session. The first call is the initial connect; every later one is a swap
   * (reconnect, backup voice, offline, back to live) that snapshots the talk, tears the old
   * transport down under a new epoch, connects, seeds and restores per arch §6.3.
   */
  private async open(
    target: VoiceTarget,
    opts: { initial?: boolean; mic?: MediaStream | null; prepared?: VoiceSession } = {},
  ) {
    const initial = opts.initial === true;
    const snap = initial ? null : this.takeSnapshot();
    this.teardown();
    const token = this.swapToken;
    const current = () => token === this.swapToken && this.isLive();
    if (opts.mic !== undefined) this.mic = opts.mic;
    if (snap) this.applyPlan(restorePlan(snap));

    const conn = this.snapshot().connection;
    if (
      !initial &&
      target === "live" &&
      (conn === "connected" || (conn === "failed" && this.everConnected))
    ) {
      this.actor.send({ type: "CONN.LOST" });
    } else if (conn === "failed") {
      this.actor.send({ type: "CONN.CONNECTING" });
    }
    this.clearError();
    this.emit();

    let voice: VoiceSession | null = null;
    if (target === "live") {
      const prepared = opts.prepared;
      if (prepared && prepared.epoch === this.registry.epoch) {
        voice = prepared;
        this.unsubscribe = voice.on(this.onEvent);
        this.voice = voice;
      } else {
        prepared?.close();
        const res = await connectWithRetry({
          attempt: () => this.attemptLive(),
          sleep: (ms) => this.sleep(ms),
          isCurrent: current,
          retryable: (e) => !(e instanceof VoiceError) || RETRYABLE.has(e.code),
        });
        if (res.status === "cancelled") return;
        if (res.status === "failed") return void this.openFailed(res.error, initial, current);
        voice = res.value;
      }
    } else {
      voice = this.attemptFallback(target);
      if (!voice) return void this.openFailed(new VoiceError("session_failed"), initial, current);
      await voice.connect({ mic: null });
    }

    if (!current()) return;
    if (snap && target === "live") {
      await seedVoice(voice, this.ctx, this.completedQA);
      if (!current()) return;
    }
    this.attempting = null;
    this.everConnected = true;
    this.applyAudio(voice);
    this.clearError();
    if (target === "live" && this.mic) this.actor.send({ type: "INPUT.VOICE" });
    this.actor.send({
      type:
        target === "live" ? "VOICE.LIVE" : target === "backup" ? "VOICE.BACKUP" : "VOICE.OFFLINE",
    });
    this.actor.send({ type: "CONN.CONNECTED" });
    if (target !== "live") this.scheduleProbe();
    this.pump();
  }

  private async attemptLive(): Promise<VoiceSession> {
    const epoch = this.registry.bumpEpoch();
    const reconnectOf = this.lastLiveSessionId ?? undefined;
    const voice = this.deps.voiceFactory(epoch, reconnectOf ? { reconnectOf } : undefined);
    this.attempting = voice;
    this.voice = voice;
    this.unsubscribe = voice.on(this.onEvent);
    this.abort = new AbortController();
    try {
      await voice.connect({ mic: this.mic, signal: this.abort.signal });
    } catch (e) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      voice.close();
      if (this.voice === voice) this.voice = null;
      throw e;
    }
    return voice;
  }

  private attemptFallback(target: "backup" | "offline"): VoiceSession | null {
    const make = this.deps.backupFactory;
    if (!make) return null;
    const epoch = this.registry.bumpEpoch();
    const voice = make(epoch, target === "offline" ? "local" : "backup", {
      displayedSlide: () => this.ctx.displayedSlide,
      history: () => this.completedQA,
    });
    this.voice = voice;
    this.unsubscribe = voice.on(this.onEvent);
    return voice;
  }

  private async openFailed(error: unknown, initial: boolean, current: () => boolean) {
    const code =
      error instanceof VoiceError
        ? (VOICE_TO_ERROR[error.code] ?? "session_failed")
        : "session_failed";
    // A dead network is "offline", not a voice-service failure (arch §6.5).
    if (RETRYABLE_CODES.has(code) && this.deps.probeHealth && this.deps.backupFactory) {
      const up = await this.deps.probeHealth();
      if (!current()) return;
      if (!up) return void this.open("offline");
    }
    this.setError(!initial && code === "session_failed" ? "connection_lost" : code);
    this.actor.send({ type: "CONN.FAILED" });
    this.emit();
  }

  /** The talk as it stands when the old transport goes away (arch §6.3 step 1). */
  private takeSnapshot(): Snapshot {
    const t = this.turn;
    let question: Snapshot["question"] = null;
    if (t) {
      question = {
        text: t.submitted ? this.questionText(t.userItemId, t.question) : "",
        submitted: t.submitted,
      };
    } else if (this.cut) {
      question = {
        text: this.questionText(this.cut.userItemId, this.cut.question),
        submitted: true,
      };
    }
    return {
      displayedSlide: this.ctx.displayedSlide,
      checkpoint: this.ctx.checkpoint,
      status: this.ctx.status,
      coveredSlides: this.ctx.coveredSlides,
      phase: this.phase,
      question,
    };
  }

  private questionText(itemId: string | null, typed: string | null) {
    return (itemId ? this.questions.find((q) => q.id === itemId)?.text : "") || typed || "";
  }

  private applyPlan(plan: RestorePlan) {
    this.notes = initialNotes();
    this.phase = plan.phase;
    this.pendingBridge = plan.bridge;
    this.cut = plan.askAgain ? { question: plan.askAgain, userItemId: "", resend: true } : null;
    if (!plan.askAgain && this.ctx.preQuestion) this.ctx = { ...this.ctx, preQuestion: null };
    if (plan.notice) this.notice = plan.notice;
  }

  /** Invalidate the old epoch first, then dispose (arch §4.4, §6.3). Safe to call at any time. */
  private teardown() {
    this.swapToken++;
    if (this.turn?.capturing) void this.voice?.endUserTurn({ cancel: true });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.registry.bumpEpoch();
    this.silentItems.clear();
    this.cancelCandidate();
    this.sleepCancel?.();
    this.abort?.abort();
    this.abort = null;
    this.timers.clearAll();
    this.setSlow(false);
    const old = this.voice;
    if (old?.sessionId) this.lastLiveSessionId = old.sessionId;
    old?.setOutputGain(0);
    old?.close();
    if (this.attempting !== old) this.attempting?.close();
    this.voice = null;
    this.attempting = null;
    this.probe.cancel();
    this.metrics.cancelAll();
    this.turn = null;
    this.cut = null;
    this.narrationReq = null;
    this.greetingReq = null;
    this.pendingBridge = undefined;
  }

  private sleep(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const handle = this.schedule(() => {
        this.sleepCancel = null;
        resolve(true);
      }, ms);
      this.sleepCancel = () => {
        this.cancelTimer(handle);
        this.sleepCancel = null;
        resolve(false);
      };
    });
  }

  private onInterruptTimeout() {
    this.debug("interrupt_timeout");
    void this.open("live");
  }

  /** Nothing can be spoken: show the scripts and stop narrating until audio is back (arch §6.4). */
  private applyAudio(voice: VoiceSession) {
    const can = voice.canSpeak?.() ?? true;
    this.audioNone = !can;
    if (!can) {
      this.noAudioPause();
    } else if (this.forcedPause) {
      this.forcedPause = false;
      if (this.ctx.status === "paused") this.ctx = setStatus(this.ctx, "running");
    }
  }

  private noAudioPause() {
    if (this.ctx.status === "running") {
      this.ctx = setStatus(this.ctx, "paused");
      this.forcedPause = true;
      this.timers.clear("resume");
    }
    if (this.phase === "awaitingResume") this.phase = "narrating";
    this.notice = "Audio unavailable — read the script below.";
  }

  // ---- backup voice, offline and the way back (arch §6.4–6.5) ----

  /** "Continue with backup voice" after live voice could not be reached. */
  continueWithBackup() {
    if (!this.isLive() || !this.view().canBackup) return;
    void this.open("backup");
  }

  /** "Try live voice again": probe now; the swap itself waits for a boundary. */
  tryLiveAgain() {
    this.probeLive(true);
  }

  /** `online` / `offline` browser events are hints; a timed probe confirms them (arch §6.5). */
  networkHint(online: boolean) {
    if (!this.isLive()) return;
    void (online ? this.confirmOnline() : this.confirmOffline());
  }

  private async confirmOffline() {
    if (this.snapshot().voice === "offline") return;
    const up = this.deps.probeHealth ? await this.deps.probeHealth() : false;
    if (up || !this.isLive() || this.snapshot().voice === "offline") return;
    await this.open("offline");
  }

  private async confirmOnline() {
    if (this.snapshot().voice === "live") return;
    const up = this.deps.probeHealth ? await this.deps.probeHealth() : true;
    if (up && this.isLive()) this.probeLive();
  }

  private scheduleProbe() {
    if (this.snapshot().voice === "live") return;
    this.timers.set("backupProbe", PROBE_MS, this.scope(null), () => this.probeLive());
  }

  /** One attempt at a time; success parks a connected adapter until a boundary (arch §6.4). */
  private probeLive(manual = false) {
    if (!this.isLive() || this.snapshot().voice === "live" || this.probing || this.candidate) {
      return;
    }
    this.timers.clear("backupProbe");
    this.probing = true;
    const token = this.swapToken;
    const reconnectOf = this.lastLiveSessionId ?? undefined;
    // The epoch it takes over when adopted: teardown bumps exactly once.
    const cand = this.deps.voiceFactory(
      this.registry.epoch + 1,
      reconnectOf ? { reconnectOf } : undefined,
    );
    this.probeAbort = new AbortController();
    cand.connect({ mic: this.mic, signal: this.probeAbort.signal }).then(
      () => {
        this.probing = false;
        if (token !== this.swapToken) return void cand.close();
        const entry = { voice: cand, dead: false };
        cand.on((e) => {
          if (e.type === "disconnected" || (e.type === "error" && e.fatal)) entry.dead = true;
        });
        this.candidate = entry;
        this.pump();
      },
      () => {
        this.probing = false;
        cand.close();
        if (token !== this.swapToken) return;
        if (manual) this.notice = "Live voice isn't available yet. We'll keep trying.";
        this.scheduleProbe();
        this.emit();
      },
    );
  }

  private cancelCandidate() {
    this.probeAbort?.abort();
    this.probeAbort = null;
    this.candidate?.voice.close();
    this.candidate = null;
    this.probing = false;
  }

  /** Between sentences, or while paused or finished: nothing in flight to lose. */
  private atBoundary() {
    return (
      this.snapshot().connection === "connected" &&
      !this.turn &&
      !this.narrationReq &&
      !this.greetingReq &&
      !this.registry.generating() &&
      !this.registry.playing()
    );
  }

  private adoptCandidate() {
    const c = this.candidate;
    if (!c) return;
    this.candidate = null;
    if (c.dead) {
      c.voice.close();
      this.scheduleProbe();
      return;
    }
    void this.open("live", { prepared: c.voice });
  }

  /** Text mode back to voice (arch §4.8): replace the track, or reconnect with an outgoing one. */
  async useMicrophone(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!this.isLive() || !track) return stream.getTracks().forEach((t) => t.stop());
    const old = this.mic;
    this.mic = stream;
    this.notice = null;
    const voice = this.voice;
    if (!voice || this.snapshot().voice !== "live") {
      this.notice = "Microphone ready. It will be used when live voice is back.";
      return this.emit();
    }
    try {
      await voice.replaceMic(track);
      if (old && old !== stream) old.getTracks().forEach((t) => t.stop());
      this.actor.send({ type: "INPUT.VOICE" });
    } catch (e) {
      if (e instanceof VoiceError && e.code === "no_sender") {
        await this.open("live", { mic: stream }); // a receive-only connection has no sender to replace
      } else {
        this.notice = "We couldn't switch to that microphone.";
      }
    }
    this.emit();
  }

  /** The browser refused the microphone again; the status stays in text mode. */
  micUnavailable() {
    this.notice =
      "We couldn't use the microphone. Allow it with the lock icon in the address bar, then try again.";
    this.emit();
  }

  // ---- events ----

  private onEvent = (e: VoiceEvent) => {
    if (!this.registry.isCurrent(e)) {
      this.staleCount++;
      return this.debug("stale_epoch", { type: e.type });
    }
    switch (e.type) {
      case "generation_started": {
        const r = this.registry.attach(e.requestId, e.responseId);
        this.debug("generation_started", { requestId: e.requestId, responseId: e.responseId });
        // A cancelled pending request stays cancelling: it is cancelled, not adopted.
        if (r && r.generation === "pending") r.generation = "active";
        return;
      }
      case "tool_call":
        return this.onToolCall(e);
      case "generation_done":
        return this.onGenerationDone(e);
      case "playback_started":
        return this.onPlayback(e.responseId, "playing");
      case "playback_completed":
        return this.onPlayback(e.responseId, "completed");
      case "playback_cleared":
        return this.onPlayback(e.responseId, "cleared");
      case "user_transcript": {
        if (e.final && isEndCommand(e.text) && this.isLatestUserItem(e.itemId)) {
          this.debug("end_requested", { via: "transcript" });
          return this.end();
        }
        if (e.final && !e.text.trim()) {
          if (this.dropSilentTurn(e.itemId)) return;
          this.silentItems.add(e.itemId); // may beat the commit result while the barrier is pending
        }
        this.captions.user(e.itemId, e.text, e.final);
        const q = this.questions.find((x) => x.id === e.itemId);
        if (q && e.final) q.text = e.text.trim();
        return this.emit();
      }
      case "agent_transcript": {
        const r = this.registry.byResponseId(e.responseId);
        this.captions.agent(e.responseId, e.delta, e.final, r?.kind, !r || r.cancelled);
        if (e.final && r?.kind === "narration" && !r.cancelled) this.checkNarrationLength(r);
        if (e.final && r && this.bridges.get(r.requestId) === "resume") {
          this.lastBridge = this.captions
            .textOf(e.responseId)
            .split(/[,.—–!?]/)[0]
            ?.trim()
            .slice(0, 40);
        }
        return this.emit();
      }
      case "disconnected":
        return this.onDisconnected(e.reason);
      case "mic_ended":
        return this.onMicEnded();
      case "audio_unavailable":
        this.audioNone = true;
        this.noAudioPause();
        return this.emit();
      case "error":
        if (e.fatal) {
          this.setError("server_error");
          return this.emit();
        }
        return this.debug("voice_error", { code: e.code });
      case "connected":
      case "user_input_committed":
      case "user_speech_started":
      case "user_speech_stopped":
        return;
    }
  };

  private onToolCall(e: Extract<VoiceEvent, { type: "tool_call" }>) {
    const r = this.registry.get(e.requestId);
    if (!r || r.toolCalls.has(e.callId)) return; // unknown or duplicate
    r.toolCalls.set(e.callId, { name: e.name, replied: false });
    if (e.name === "goto_slide" && !r.cancelled && this.turn && r.turnId === this.turn.id) {
      this.metrics.start("toolRoundTrip");
      this.armSound("toolRoundTrip");
    }

    const t = this.turn;
    const stale = r.cancelled || !t || r.turnId !== t.id;
    const output = stale ? { ok: false, cancelled: true } : this.applyTool(t, e.name, e.args);
    const itemId = this.voice!.sendToolResult(e.callId, output);
    r.toolCalls.get(e.callId)!.replied = true;
    if (stale) return;
    t.toolItemIds.push(itemId);
    if (e.name === "end_presentation") {
      // Same as the End button: at once, with no farewell audio (arch §6.6).
      this.debug("end_requested", { via: "tool" });
      return this.end();
    }
    if (e.name === "resume_presentation") {
      // A no-op once the talk has finished (arch §5.5).
      if (this.ctx.status !== "finished") t.resumeRequested = true;
    } else if (e.name === "offer_end") {
      if (t.endOffer === "none") t.endOffer = "requested";
    } else if (!this.voice?.selfContained) t.needsContinuation = true;
    this.emit();
  }

  private applyTool(t: Turn, name: string, args: unknown): Record<string, unknown> {
    if (name === "resume_presentation") {
      return this.ctx.status === "finished" ? { ok: true, no_op: true } : { ok: true };
    }
    if (name === "offer_end" || name === "end_presentation") return { ok: true };
    if (name !== "goto_slide") {
      t.invalidTools++;
      return { ok: false, error: "unknown tool" };
    }
    const parsed = GotoSlideArgs.safeParse(args);
    if (!parsed.success) {
      t.invalidTools++;
      return { ok: false, error: "unknown slide_id", valid: SLIDE_IDS };
    }
    const { slide_id, intent } = parsed.data;
    if (intent === "stay") {
      if (slide_id !== this.ctx.displayedSlide) {
        t.invalidTools++;
        return {
          ok: false,
          error: "stay must name the displayed slide",
          displayed: this.ctx.displayedSlide,
        };
      }
      this.ctx = stayHere(this.ctx);
      return { ok: true, slide_title: slideById(slide_id).title };
    }
    if (slide_id === this.ctx.displayedSlide) {
      if (intent === "user_request") this.ctx = explicitNavigate(this.ctx, slide_id);
      return { ok: true, already_showing: true };
    }
    // The slide moves before the continuation is requested (arch §4.10).
    t.slideChanged = true;
    t.slideDoneAt = null;
    this.ctx =
      intent === "answer"
        ? answerNavigate(this.ctx, slide_id)
        : explicitNavigate(this.ctx, slide_id);
    return { ok: true, slide_title: slideById(slide_id).title };
  }

  private onGenerationDone(e: Extract<VoiceEvent, { type: "generation_done" }>) {
    const r = this.registry.get(e.requestId);
    if (!r) return;
    if (e.usage?.totalTokens !== undefined && (r.kind === "answer" || r.kind === "continuation")) {
      this.convTokens = e.usage.totalTokens;
    }
    if (!r.responseId) this.registry.attach(e.requestId, e.responseId);
    r.generation = "done";
    r.hadAudio = e.hadAudio;
    r.outputItemIds = e.outputItemIds ?? [];
    if (r.cancelled) {
      // Cancelled answer fragments are deleted, not left half-said (arch §5.10).
      if ((r.kind === "answer" || r.kind === "continuation") && r.outputItemIds.length) {
        this.voice?.deleteItems(r.outputItemIds);
      }
      return this.pump();
    }
    if (e.status !== "completed") {
      if (this.turn && r.turnId === this.turn.id) return this.failTurn("response_failed");
      if (r.requestId === this.narrationReq) this.narrationReq = null;
      if (r.requestId === this.greetingReq) this.greetingReq = null;
      this.setError("response_failed");
    }
    this.pump();
  }

  private onPlayback(responseId: string, state: RequestRecord["playback"]) {
    const r = this.registry.byResponseId(responseId);
    if (!r) return this.debug("unknown_playback", { state });
    r.playback = state;
    if (state === "cleared") this.captions.interrupted(responseId);
    if (state === "playing" && !r.cancelled && this.turn && r.turnId === this.turn.id) {
      // Thinking ends with the first audible answer, not with a tool result.
      this.timers.clear("thinkSlow", "thinkTimeout");
      this.setSlow(false);
    }
    if (!r.cancelled) {
      if (state === "completed" && r.kind === "narration") this.onSentencePlayed(r);
      if (state === "completed" && r.kind === "greeting" && r.requestId === this.greetingReq) {
        this.greetingReq = null;
        this.phase = "narrating";
      }
      // A clear we didn't ask for never advances narration; the sentence is requested again.
      if (state === "cleared" && r.requestId === this.narrationReq) this.narrationReq = null;
      if (state === "cleared" && r.requestId === this.greetingReq) this.greetingReq = null;
    }
    this.pump();
  }

  private onSentencePlayed(r: RequestRecord) {
    if (r.requestId !== this.narrationReq) return;
    this.narrationReq = null;
    const played = this.ctx.checkpoint;
    const res = sentencePlayed(this.ctx);
    this.ctx = res.ctx;
    if (res.slideDone) this.writeNote(played.slideId, played.sentenceIndex);
    if (res.finished) this.phase = "finished";
    else {
      this.metrics.start("narrationGap");
      this.armSound("narrationGap");
    }
  }

  private onDisconnected(reason: "network" | "server" | "closed" | "time_limit") {
    if (reason === "time_limit") return this.end();
    void this.open("live"); // arch §6.3: snapshot, new epoch, retries, restore
  }

  private onMicEnded() {
    if (this.turn?.capturing) this.cancelCapture("escape");
    this.mic?.getTracks().forEach((t) => t.stop()); // an ended stream must not seed a reconnect
    this.mic = null;
    this.actor.send({ type: "INPUT.TEXT", reason: "mic_lost" });
    this.notice = "Your microphone disconnected. You can keep going by typing.";
    this.emit();
  }

  // ---- arbiter ----

  /** Reserve before sending; one generation at a time; narration waits for playback (arch §4.3). */
  private request(
    kind: ResponseKind,
    opts: Omit<ResponseRequest, "requestId" | "turnId" | "kind">,
  ): string | null {
    const voice = this.voice;
    if (!voice || this.registry.generating()) return null; // retried when the barrier releases
    if (kind === "narration" && this.registry.playing()) return null;
    const requestId = crypto.randomUUID();
    const turnId = kind === "answer" || kind === "continuation" ? (this.turn?.id ?? null) : null;
    this.registry.reserve({
      requestId,
      turnId,
      kind,
      ...(opts.slideId !== undefined ? { slideId: opts.slideId } : {}),
      ...(opts.sentenceIndex !== undefined ? { sentenceIndex: opts.sentenceIndex } : {}),
    });
    this.debug("create_response", {
      kind,
      requestId,
      ...(opts.slideId !== undefined ? { slideId: opts.slideId } : {}),
      ...(opts.sentenceIndex !== undefined ? { sentenceIndex: opts.sentenceIndex } : {}),
    });
    // Output stays muted until old playback is cleared; this is the authorized replacement.
    if (!this.registry.playing()) voice.setOutputGain(1);
    voice.createResponse({ requestId, turnId, kind, ...opts });
    return requestId;
  }

  /** Decide the next step after any change; never creates a response the rules don't allow. */
  private pump() {
    if (!this.isLive() || !this.voice || this.snapshot().connection !== "connected")
      return this.emit();
    const t = this.turn;
    if (t) {
      if (t.submitted && t.currentRequestId) {
        const r = this.registry.get(t.currentRequestId);
        if (r && audioSettled(r)) {
          t.currentRequestId = null;
          this.afterResponseBarrier(t);
        }
      } else if (t.submitted && t.pendingKind) {
        this.issueTurnRequest(t.pendingKind);
      }
      // The question may have just finished (resume_presentation narrates at once).
      if (this.turn) return this.emit();
    }
    if (this.candidate && this.atBoundary()) {
      this.adoptCandidate();
      return this.emit();
    }
    this.maybeNarrate();
    this.emit();
  }

  private maybeNarrate() {
    if (this.typing || this.turn || this.cut || this.snapshot().error || this.audioNone) return;
    if (this.ctx.status !== "running") return;
    if (this.phase === "greeting") {
      if (this.greetingReq) return;
      this.greetingReq = this.request("greeting", {
        instructions: greetingInstructions({ textOnly: this.snapshot().input === "text" }),
        toolChoice: "none",
        outOfBand: true,
      });
      return;
    }
    if (this.phase !== "narrating" || this.narrationReq) return;
    if (this.registry.generating() || this.registry.playing()) return;
    const bridge = this.pendingBridge;
    this.ctx = showCheckpoint(this.ctx); // slides change only when their sentence begins
    const { slideId, sentenceIndex } = this.ctx.checkpoint;
    const slide = slideById(slideId);
    const id = this.request("narration", {
      instructions: narrationInstructions({
        slide,
        sentenceIndex,
        ...(bridge ? { bridge } : {}),
        ...(bridge === "resume" && this.lastBridge ? { lastBridge: this.lastBridge } : {}),
      }),
      toolChoice: "none",
      outOfBand: true,
      slideId,
      sentenceIndex,
      ...(bridge ? { bridge } : {}),
    });
    if (!id) return;
    this.narrationReq = id;
    if (bridge) this.bridges.set(id, bridge);
    this.pendingBridge = undefined;
  }

  private issueTurnRequest(kind: "answer" | "continuation") {
    const t = this.turn;
    if (!t) return;
    const offering = t.endOffer === "offering";
    const id = this.request(kind, {
      instructions: offering
        ? endOfferInstructions({ textOnly: this.snapshot().input === "text" })
        : answerReanchor(),
      toolChoice: offering ? "none" : "auto",
      outOfBand: false,
    });
    if (id) {
      t.currentRequestId = id;
      t.requestIds.push(id);
      t.pendingKind = null;
    } else t.pendingKind = kind;
  }

  /** The turn's response has finished generating AND its audio (if any) has finished playing. */
  private afterResponseBarrier(t: Turn) {
    if (t.endOffer === "requested") {
      // The offer is a fixed line, spoken once; the talk then waits for an answer.
      t.endOffer = "offering";
      return this.issueTurnRequest("continuation");
    }
    if (t.endOffer === "offering") return this.pauseAfterEndOffer();
    if (t.resumeRequested) return this.finishQuestion(true);
    if (t.invalidTools >= 2) return this.failTurn("response_failed");
    if (t.needsContinuation) {
      if (t.continuations >= 2) return this.failTurn("response_failed");
      t.needsContinuation = false;
      t.continuations++;
      return this.issueTurnRequest("continuation");
    }
    this.finishQuestion(false);
  }

  /** After the end offer, pause on the current sentence until the listener ends or resumes. */
  private pauseAfterEndOffer() {
    this.finishQuestion(false);
    this.ctx = setStatus(this.ctx, "paused");
    this.timers.clear("resume");
    if (this.phase === "awaitingResume") this.phase = "narrating";
  }

  /** The user item of the turn being answered, or of the last question asked. */
  private isLatestUserItem(itemId: string) {
    const t = this.turn;
    if (t?.submitted && (t.userItemId === itemId || t.userItemId === null)) return true;
    return this.questions.at(-1)?.id === itemId;
  }

  private finishQuestion(resume: boolean) {
    const t = this.turn!;
    this.timers.clear("thinkSlow", "thinkTimeout");
    this.setSlow(false);
    this.recordQaPair(t);
    this.turn = null;
    this.cut = null;
    this.afterQuestion(resume);
  }

  /** Restore after a question per the checkpoint rules (arch §4.7). */
  private afterQuestion(resume: boolean) {
    const { ctx, next } = questionDone(this.ctx);
    this.ctx = ctx;
    if (resume && ctx.status !== "finished") {
      this.ctx = setStatus(this.ctx, "running");
      this.phase = "narrating";
      this.pendingBridge = this.bridgeFor();
      return;
    }
    if (next === "awaitResume") {
      this.phase = "awaitingResume";
      this.timers.set("resume", TIMING.resumeWindowMs, this.scope(null), () => {
        if (this.ctx.status !== "running") return;
        this.phase = "narrating";
        this.pendingBridge = this.bridgeFor();
        this.pump();
      });
      return;
    }
    this.phase =
      ctx.status === "finished" ? "finished" : this.phase === "greeting" ? "greeting" : "narrating";
  }

  private failTurn(code: ErrorCode) {
    const t = this.turn;
    if (t?.userItemId) this.cut = toCut(t);
    this.turn = null;
    this.interruptAll();
    this.timers.clear("thinkSlow", "thinkTimeout");
    this.setSlow(false);
    this.setError(code);
    this.emit();
  }

  private sendCapture = async () => {
    const t = this.turn;
    const voice = this.voice;
    if (!t?.capturing || !voice) return;
    this.timers.clear("orb");
    t.capturing = false;
    t.submitted = true;
    this.metrics.start("answerLatency");
    this.armSound("answerLatency");
    this.startThinking();
    this.emit();
    const epoch = this.registry.epoch;
    const [res, cleared] = await Promise.all([
      voice.endUserTurn({ cancel: false }),
      this.turnBarrier,
    ]);
    if (this.turn !== t || epoch !== this.registry.epoch) return;
    if (cleared === "timeout") return this.onInterruptTimeout();
    if (!res.committed || !res.itemId) {
      this.dropEmptyTurn(t);
      return this.pump();
    }
    if (this.silentItems.delete(res.itemId)) {
      // Its transcript already came back empty: silence or noise, so no answer is requested.
      t.userItemId = res.itemId;
      this.debug("empty_transcript_dropped", { turnId: t.id });
      voice.deleteItems([res.itemId]);
      this.dropEmptyTurn(t);
      return this.pump();
    }
    t.userItemId = res.itemId;
    this.captions.reserveUser(res.itemId);
    this.questions.push({ id: res.itemId, text: "" });
    this.issueTurnRequest("answer");
    this.pump();
  };

  /** A confirmed empty turn returns to the saved status. */
  private dropEmptyTurn(t: Turn) {
    this.turn = null;
    this.timers.clear("thinkSlow", "thinkTimeout");
    this.setSlow(false);
    // No answer follows, so the resumed narration's first sound must not end answerLatency.
    this.metrics.cancel("answerLatency");
    const itemId = t.userItemId;
    if (itemId) {
      this.captions.dropUser(itemId);
      this.questions = this.questions.filter((q) => q.id !== itemId);
    }
    this.restoreAfterCancel(t);
  }

  /**
   * The answer is requested at commit, before the transcript exists. An empty final transcript is
   * confirmed silence or noise: cancel the answer if none of it has been heard yet and no tool has
   * been applied, and handle the turn as a confirmed empty one. Returns whether it was dropped.
   */
  private dropSilentTurn(itemId: string): boolean {
    const t = this.turn;
    if (!t?.submitted || t.userItemId !== itemId) return false;
    if (t.source !== "space" && t.source !== "orb") return false;
    const heard = t.requestIds.some((id) => (this.registry.get(id)?.playback ?? "none") !== "none");
    if (heard || t.toolItemIds.length > 0) return false;
    this.debug("empty_transcript_dropped", { turnId: t.id });
    const barrier = this.interruptAll();
    this.voice?.deleteItems([itemId]);
    this.dropEmptyTurn(t);
    this.pump();
    void barrier.then(() => this.pump());
    return true;
  }

  /** Detection only: flag narration that said much more than its sentence. Never blocks playback. */
  private checkNarrationLength(r: RequestRecord) {
    if (r.slideId === undefined || r.sentenceIndex === undefined || !r.responseId) return;
    const scripted = slideById(r.slideId as SlideId).segments[r.sentenceIndex]?.text;
    if (!scripted) return;
    const spoken = this.captions.textOf(r.responseId);
    if (!narrationOverrun(spoken, scripted, this.bridges.has(r.requestId))) return;
    this.narrationOverruns++;
    this.debug("narration_overrun", {
      requestId: r.requestId,
      slideId: r.slideId,
      sentenceIndex: r.sentenceIndex,
      spokenChars: spoken.trim().length,
      scriptedChars: scripted.length,
    });
  }

  private cancelCapture(reason: "accidental" | "escape" | "focusLost") {
    const t = this.turn;
    if (!t?.capturing) return;
    this.timers.clear("orb");
    void this.voice?.endUserTurn({ cancel: true });
    this.turn = null;
    this.restoreAfterCancel(t);
    // Focus loss never submits and leaves the talk paused until explicit Resume (brief §9).
    if (reason === "focusLost") this.ctx = setStatus(this.ctx, "paused");
    this.pump();
    void this.turnBarrier.then(() => this.pump());
  }

  /** Accidental press, Esc or empty input: restart the sentence, keep paused/finished, or offer Ask again. */
  private restoreAfterCancel(t: Turn) {
    if (t.cutBefore) {
      this.cut = t.cutBefore;
      return;
    }
    if (this.ctx.preQuestion) this.ctx = { ...this.ctx, preQuestion: null };
    if (this.phase === "awaitingResume") {
      this.phase = "narrating";
      this.pendingBridge = this.bridgeFor();
    }
  }

  /** Cancel playback and generation at once and invalidate their work. */
  private interruptAll(): Promise<"cleared" | "timeout"> {
    if (this.narrationReq) {
      const { slideId, sentenceIndex } = this.ctx.checkpoint;
      if (this.ctx.coveredSlides.includes(slideId)) this.writeNote(slideId, sentenceIndex - 1);
      this.narrationReq = null;
    }
    this.greetingReq = null;
    // Obsolete audio must not complete a measurement that belongs to cancelled work.
    this.metrics.cancel(
      "narrationGap",
      "toolRoundTrip",
      "answerLatency",
      "typedLatency",
      "greeting",
    );
    this.registry.cancelInFlight();
    this.timers.clear("resume");
    return this.voice ? this.voice.interrupt() : Promise.resolve("cleared");
  }

  private startThinking() {
    const scope = this.scope();
    this.setSlow(false);
    this.timers.set("thinkSlow", TIMING.thinkingSlowMs, scope, () => {
      this.setSlow(true);
      this.emit();
    });
    this.timers.set("thinkTimeout", TIMING.thinkingTimeoutMs, scope, () =>
      this.failTurn("response_timeout"),
    );
  }

  // ---- notes and pruning (arch §5.10) ----

  private writeNote(slideId: SlideId, playedThrough: number) {
    const voice = this.voice;
    if (!voice) return;
    const slide = slideById(slideId);
    const plan = noteForPlayed(this.notes, slide, playedThrough);
    if (!plan.add) return;
    const existing = this.notes.notes[slideId];
    if (plan.remove && existing?.itemId) voice.deleteItems([plan.remove]);
    const entry = { itemId: "", full: playedThrough + 1 >= slide.segments.length };
    this.notes.notes[slideId] = entry;
    void voice.addControllerNote(plan.add).then((id) => {
      if (this.notes.notes[slideId] === entry) entry.itemId = id;
    });
  }

  private recordQaPair(t: Turn) {
    const voice = this.voice;
    if (!voice || !t.userItemId) return;
    const recs = t.requestIds
      .map((id) => this.registry.get(id))
      .filter((r): r is RequestRecord => !!r);
    const itemIds = [t.userItemId, ...recs.flatMap((r) => r.outputItemIds), ...t.toolItemIds];
    const factIds = this.captions.factIdsOf(recs.map((r) => r.responseId ?? ""));
    this.notes.qaPairs.push({ itemIds, factIds });
    const q = this.questionText(t.userItemId, t.question);
    const a = recs
      .filter((r) => r.kind === "answer" || r.kind === "continuation")
      .map((r) => this.captions.textOf(r.responseId ?? ""))
      .join(" ")
      .trim();
    if (q && a) this.completedQA = [...this.completedQA, { q, a }].slice(-6);
    const plan = prunePlan(this.notes);
    if (plan.delete.length === 0) return;
    voice.deleteItems(plan.delete);
    this.notes.qaPairs = plan.keep;
    this.notes.pruneNoteId = null;
    if (plan.note) {
      void voice.addControllerNote(plan.note).then((id) => {
        this.notes.pruneNoteId = id;
      });
    }
  }

  // ---- helpers ----

  private newTurn(
    source: TurnSource,
    opts: {
      capturing?: boolean;
      submitted?: boolean;
      question?: string | null;
      cutBefore?: Cut | null;
    },
  ): Turn {
    return {
      id: crypto.randomUUID(),
      source,
      question: opts.question ?? null,
      userItemId: null,
      startedAt: this.now(),
      capturing: opts.capturing ?? false,
      submitted: opts.submitted ?? false,
      currentRequestId: null,
      pendingKind: null,
      requestIds: [],
      toolItemIds: [],
      needsContinuation: false,
      resumeRequested: false,
      continuations: 0,
      invalidTools: 0,
      cutBefore: opts.cutBefore ?? null,
      firstSoundAt: null,
      slideChanged: false,
      slideDoneAt: null,
      endOffer: "none",
    };
  }

  private bridgeFor(): Bridge | undefined {
    if (this.ctx.displayedSlide !== this.ctx.checkpoint.slideId) return "return";
    if (this.ctx.checkpoint.sentenceIndex > 0) return "resume";
    return undefined;
  }

  private scope(turnId: string | null = this.turn?.id ?? null): TimerScope {
    return { epoch: this.registry.epoch, turnId };
  }

  private isLive() {
    return this.actor.getSnapshot().matches("live");
  }

  private snapshot() {
    return toStatusSnapshot(this.actor.getSnapshot());
  }

  private controls() {
    return controlsOf(this.snapshot());
  }

  private setError(code: ErrorCode) {
    this.actor.send({ type: "ERROR.SET", code });
  }

  private clearError() {
    this.actor.send({ type: "ERROR.CLEAR" });
  }

  private clearAnswerError() {
    const err = this.snapshot().error;
    if (err === "response_timeout" || err === "response_failed") this.clearError();
  }

  private setSlow(slow: boolean) {
    if (this.actor.getSnapshot().context.slow !== slow) this.actor.send({ type: "SLOW.SET", slow });
  }

  private debug(msg: string, data?: Record<string, unknown>) {
    this.deps.debug?.(msg, data);
  }

  /** Mirror controller state into the machine, then publish a new view. */
  private emit() {
    if (this.isLive()) {
      const playing = this.registry.playing();
      const agent: keyof typeof AGENT_EVENT = this.turn?.capturing
        ? "listening"
        : this.typing
          ? "pausedTyping"
          : playing && !playing.cancelled
            ? "speaking"
            : this.turn?.submitted
              ? "thinking"
              : this.ctx.status === "paused"
                ? "paused"
                : "idle";
      const presentation: keyof typeof PRESENTATION_EVENT =
        this.turn?.submitted || this.cut ? "answering" : this.phase;
      this.send(this.sent.agent === agent ? null : { type: AGENT_EVENT[agent] });
      this.sent.agent = agent;
      this.send(
        this.sent.presentation === presentation ? null : { type: PRESENTATION_EVENT[presentation] },
      );
      this.sent.presentation = presentation;
    }
    this.cached = this.buildView();
    for (const l of [...this.listeners]) l();
  }

  private canBackup(s: StatusSnapshot) {
    if (s.connection !== "failed" || !this.deps.backupFactory) return false;
    return ERROR_ACTIONS[s.error ?? "session_failed"].includes("backup");
  }

  private send(e: SessionEvent | null) {
    if (e) this.actor.send(e);
  }

  private buildView(): ControllerView {
    const snap = this.actor.getSnapshot();
    const s = toStatusSnapshot(snap);
    const { checkpoint, displayedSlide } = this.ctx;
    const narrating = this.narrationReq !== null && displayedSlide === checkpoint.slideId;
    return {
      screen: screenOf(snap),
      status: statusLabel(s),
      orb: orbState(s),
      snapshot: s,
      controls: controlsOf(s),
      displayedSlide,
      slideIndex: indexOf(displayedSlide),
      checkpoint,
      presentationStatus: this.ctx.status,
      highlightBullet: narrating
        ? (slideById(checkpoint.slideId).segments[checkpoint.sentenceIndex]?.bullet ?? null)
        : null,
      captions: this.captions.view,
      showStayHere: s.connection !== "idle" && !s.ended && displayedSlide !== checkpoint.slideId,
      askAgain: this.cut !== null,
      capturing: this.turn?.capturing ? (this.turn.source === "orb" ? "orb" : "space") : null,
      typing: this.typing,
      questions: this.questions.map((q) => q.text || "(spoken question)"),
      notice: this.notice,
      scriptMode: this.audioNone,
      canBackup: this.canBackup(s),
      canTryLive: s.voice !== "live" && !s.ended,
      canTryMic: s.input === "text" && s.connection !== "idle" && !s.ended,
      debug: {
        epoch: this.registry.epoch,
        generating: this.registry.generating()?.requestId ?? null,
        playing: this.registry.playing()?.requestId ?? null,
        narrationOverruns: this.narrationOverruns,
      },
    };
  }
}

const toCut = (t: Turn): Cut => ({ question: t.question, userItemId: t.userItemId! });

export const createController = (deps: ControllerDeps) => new PresentationController(deps);

/** The deck size, for UI counters. */
export const SLIDE_COUNT = deck.length;
