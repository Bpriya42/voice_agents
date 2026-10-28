/** Error codes the status can show (arch §6.2). */
export type ErrorCode =
  | "mic_denied"
  | "mic_not_found"
  | "mic_silent"
  | "mic_lost"
  | "not_configured"
  | "quota"
  | "demo_paused"
  | "demo_busy"
  | "quota_reached"
  | "bot_check_failed"
  | "backend_unreachable"
  | "session_failed"
  | "connection_lost"
  | "response_timeout"
  | "response_failed"
  | "autoplay_blocked"
  | "rate_limited"
  | "server_error";

export const ERROR_COPY: Record<ErrorCode, string> = {
  mic_denied: "Microphone access is blocked.",
  mic_not_found: "We couldn't find a microphone.",
  mic_silent: "We can't hear anything from your microphone.",
  mic_lost: "Your microphone disconnected.",
  not_configured: "Server isn't configured — see README.",
  quota: "The API key has no credit left.",
  demo_paused: "The hosted demo is paused for this month.",
  demo_busy: "Demo is busy, try again in a minute.",
  quota_reached: "You've reached today's demo limit.",
  bot_check_failed: "The bot check didn't pass. Try again.",
  backend_unreachable: "Our server isn't responding.",
  session_failed: "Can't connect to the voice service.",
  connection_lost: "Connection lost.",
  response_timeout: "That took too long.",
  response_failed: "Something went wrong with that answer.",
  autoplay_blocked: "Tap to enable sound.",
  rate_limited: "Too many requests. Try again in a moment.",
  server_error: "Something went wrong on our side.",
};

export interface StatusSnapshot {
  ended: boolean;
  connection: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  voice: "live" | "backup" | "offline";
  agent: "idle" | "listening" | "thinking" | "speaking" | "paused" | "pausedTyping";
  input: "voice" | "text";
  turnMode: "tapToTalk" | "handsFree";
  presentation: "greeting" | "narrating" | "answering" | "awaitingResume" | "finished";
  error: ErrorCode | null;
  slow: boolean;
}

export type Tone = "info" | "error" | "busy";

/** The status label in priority order (arch §4.5). Text-only modes never say "hold Space". */
export function statusLabel(s: StatusSnapshot): { label: string; tone: Tone } {
  if (s.ended) return { label: "Thanks for listening", tone: "info" };
  if (s.connection === "connecting") return { label: "Connecting…", tone: "busy" };
  if (s.connection === "reconnecting")
    return { label: "Connection lost — reconnecting…", tone: "busy" };
  if (s.error) return { label: ERROR_COPY[s.error], tone: "error" };
  if (s.connection === "failed") return { label: ERROR_COPY.session_failed, tone: "error" };
  if (s.voice === "offline")
    return { label: "You're offline — questions are paused", tone: "info" };
  if (s.agent === "pausedTyping") return { label: "Paused while you type", tone: "info" };
  if (s.agent === "paused") return { label: "Paused — press Resume or P", tone: "info" };
  const textOnly = s.input === "text" || s.voice === "backup";
  if (s.agent === "speaking") {
    return {
      label: textOnly ? "Speaking — type to interrupt" : "Speaking — hold Space to interrupt",
      tone: "info",
    };
  }
  if (s.agent === "thinking")
    return { label: s.slow ? "Still working…" : "Thinking…", tone: "busy" };
  if (s.agent === "listening") return { label: "Listening…", tone: "info" };
  if (s.presentation === "finished") {
    return {
      label: textOnly ? "Any final questions? Type below" : "Any final questions? Hold Space",
      tone: "info",
    };
  }
  if (textOnly) return { label: "Type your question below", tone: "info" };
  return {
    label: s.turnMode === "handsFree" ? "Listening for you…" : "Hold Space or tap to talk",
    tone: "info",
  };
}

/** The orb's visual state: shape or motion + colour + label, never colour alone (brief §8). */
export type OrbState =
  | "connecting"
  | "speaking"
  | "listening"
  | "thinking"
  | "paused"
  | "ready"
  | "text"
  | "error"
  | "ended";

export function orbState(s: StatusSnapshot): OrbState {
  if (s.ended) return "ended";
  if (s.connection === "connecting" || s.connection === "reconnecting") return "connecting";
  if (s.error || s.connection === "failed") return "error";
  if (s.agent === "speaking") return "speaking";
  if (s.agent === "listening") return "listening";
  if (s.agent === "thinking") return "thinking";
  if (s.agent === "paused" || s.agent === "pausedTyping") return "paused";
  if (s.input === "text" || s.voice !== "live") return "text";
  return "ready";
}
