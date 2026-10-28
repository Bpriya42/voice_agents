import type { SlideId } from "@ava/shared";

export type ResponseKind = "greeting" | "narration" | "answer" | "continuation";
export type ToolName = "goto_slide" | "resume_presentation";
export type GenerationStatus = "completed" | "cancelled" | "failed" | "incomplete";

export type VoiceErrorCode =
  | "not_configured"
  | "quota"
  | "demo_paused"
  | "demo_busy"
  | "quota_reached"
  | "rate_limited"
  | "bot_check_failed"
  | "backend_unreachable"
  | "session_failed"
  | "server_error"
  | "no_sender";

export interface Usage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Normalized adapter events (arch §4.2). Every event carries the adapter's epoch. */
export type VoiceEvent = { sessionEpoch: number } & (
  | { type: "connected" }
  | { type: "disconnected"; reason: "network" | "server" | "closed" | "time_limit" }
  | { type: "user_speech_started" | "user_speech_stopped" }
  | { type: "user_input_committed"; turnId: string; itemId: string }
  /** Non-final events carry a delta; the final event carries the full transcript. */
  | { type: "user_transcript"; itemId: string; text: string; final: boolean }
  | { type: "generation_started"; requestId: string; responseId: string }
  | {
      type: "generation_done";
      requestId: string;
      responseId: string;
      status: GenerationStatus;
      hadAudio: boolean;
      usage?: Usage;
      /** Conversation items the response produced, for deleting cancelled fragments and pruning. */
      outputItemIds?: string[];
    }
  | { type: "playback_started"; responseId: string }
  | { type: "playback_completed"; responseId: string }
  | { type: "playback_cleared"; responseId: string }
  | { type: "agent_transcript"; responseId: string; delta: string; final: boolean }
  | {
      type: "tool_call";
      requestId: string;
      responseId: string;
      callId: string;
      name: ToolName;
      args: unknown;
    }
  | { type: "mic_ended" }
  /** Local speech failed or doesn't exist: the scripts are shown instead (arch §6.4). */
  | { type: "audio_unavailable" }
  | { type: "error"; code: VoiceErrorCode; message: string; fatal: boolean }
);

/** VoiceEvent minus the epoch, for adapters to emit. */
export type VoiceEventBody = VoiceEvent extends infer E
  ? E extends { sessionEpoch: number }
    ? Omit<E, "sessionEpoch">
    : never
  : never;

export interface ResponseRequest {
  requestId: string;
  turnId: string | null;
  kind: ResponseKind;
  instructions: string;
  toolChoice: "auto" | "none";
  /** conversation: "none" (arch §5.10). */
  outOfBand: boolean;
  slideId?: SlideId;
  sentenceIndex?: number;
  /** Narration lead-in. Only the text-driven adapters use it; Realtime gets it in `instructions`. */
  bridge?: "resume" | "return" | "reconnect";
}

/**
 * The adapter contract (arch §4.2). Adapters execute commands and normalize events; they never
 * decide. The controller creates a new instance per epoch, and an adapter never changes its epoch.
 */
export interface VoiceSession {
  readonly epoch: number;
  /** Our server's session id once connected (null for fakes and before connect). */
  readonly sessionId: string | null;
  /**
   * True when one response carries the whole answer, tool effects included (the backup voice), so
   * a navigation tool never needs a continuation. Undefined for Realtime.
   */
  readonly selfContained?: boolean;
  /** False when nothing can be spoken (no speech engine, or no local voice offline). */
  canSpeak?(): boolean;
  connect(opts: { mic: MediaStream | null; signal?: AbortSignal }): Promise<void>;
  close(): void;
  createResponse(req: ResponseRequest): void;
  /** Appends a user message only; returns its conversation item id. */
  sendUserText(text: string): string;
  /** Replays an earlier answer as an assistant message (reconnect seed, arch §5.7). */
  addAssistantText(text: string): void;
  /** Appends a function result only; returns its conversation item id. */
  sendToolResult(callId: string, output: unknown): string;
  interrupt(): Promise<"cleared" | "timeout">;
  beginUserTurn(turnId: string): void;
  endUserTurn(opts: { cancel: boolean }): Promise<{ committed: boolean; itemId?: string }>;
  /** Resolves to the item id. Notes are controller text from deck data only. */
  addControllerNote(text: string): Promise<string>;
  deleteItems(ids: string[]): void;
  setMicEnabled(enabled: boolean): void;
  setTurnMode(mode: "tapToTalk" | "handsFree"): void;
  replaceMic(track: MediaStreamTrack): Promise<void>;
  setOutputGain(gain: 0 | 1): void;
  /** Post-gate output level 0..1 for the orb; not proof of audible playback. */
  outputLevel(): number;
  on(listener: (e: VoiceEvent) => void): () => void;
}

export class VoiceError extends Error {
  constructor(readonly code: VoiceErrorCode) {
    super(code);
    this.name = "VoiceError";
  }
}

/** Client-chosen conversation item ids (Realtime accepts up to 32 characters). */
export function newItemId(prefix = "item"): string {
  const rand = crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 32 - prefix.length - 1);
  return `${prefix}_${rand}`;
}
