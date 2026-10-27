import { assign, setup, type SnapshotFrom } from "xstate";
import type { ErrorCode, StatusSnapshot } from "./status.js";

export type SessionEvent =
  | { type: "SETUP.MIC_CHECK" }
  | { type: "SETUP.BACK" }
  | { type: "SETUP.READY" }
  | { type: "START"; input: "voice" | "text" }
  | { type: "CONN.CONNECTING" }
  | { type: "CONN.CONNECTED" }
  | { type: "CONN.LOST" }
  | { type: "CONN.FAILED" }
  | { type: "VOICE.LIVE" }
  | { type: "VOICE.BACKUP" }
  | { type: "VOICE.OFFLINE" }
  | { type: "AGENT.IDLE" }
  | { type: "AGENT.LISTENING" }
  | { type: "AGENT.THINKING" }
  | { type: "AGENT.SPEAKING" }
  | { type: "AGENT.PAUSED" }
  | { type: "AGENT.PAUSED_TYPING" }
  | { type: "INPUT.TEXT"; reason?: "no_mic" | "mic_lost" | "muted" }
  | { type: "INPUT.VOICE" }
  | { type: "TURN_MODE.TAP" }
  | { type: "TURN_MODE.HANDS_FREE" }
  | { type: "PRESENTATION.GREETING" }
  | { type: "PRESENTATION.NARRATING" }
  | { type: "PRESENTATION.ANSWERING" }
  | { type: "PRESENTATION.AWAITING_RESUME" }
  | { type: "PRESENTATION.FINISHED" }
  | { type: "ERROR.SET"; code: ErrorCode }
  | { type: "ERROR.CLEAR" }
  | { type: "SLOW.SET"; slow: boolean }
  | { type: "END" }
  | { type: "RESTART" };

interface Ctx {
  error: ErrorCode | null;
  slow: boolean;
  startInput: "voice" | "text";
}

/**
 * Session state (arch §4.5). The controller owns the presentation context and sends events; the
 * machine owns which state each region is in and therefore which controls are enabled.
 */
export const sessionMachine = setup({
  types: { context: {} as Ctx, events: {} as SessionEvent },
}).createMachine({
  id: "session",
  initial: "setup",
  context: { error: null, slow: false, startInput: "voice" },
  states: {
    setup: {
      initial: "landing",
      states: {
        landing: { on: { "SETUP.MIC_CHECK": "micCheck", "SETUP.READY": "ready" } },
        micCheck: { on: { "SETUP.READY": "ready", "SETUP.BACK": "landing" } },
        ready: { on: { "SETUP.MIC_CHECK": "micCheck", "SETUP.BACK": "landing" } },
      },
      on: {
        START: {
          target: "live",
          actions: assign({ startInput: ({ event }) => event.input, error: null, slow: false }),
        },
      },
    },
    live: {
      type: "parallel",
      on: {
        END: "ended",
        "ERROR.SET": { actions: assign({ error: ({ event }) => event.code }) },
        "ERROR.CLEAR": { actions: assign({ error: null }) },
        "SLOW.SET": { actions: assign({ slow: ({ event }) => event.slow }) },
      },
      states: {
        connection: {
          initial: "connecting",
          states: {
            connecting: { on: { "CONN.CONNECTED": "connected", "CONN.FAILED": "failed" } },
            connected: { on: { "CONN.LOST": "reconnecting", "CONN.FAILED": "failed" } },
            reconnecting: { on: { "CONN.CONNECTED": "connected", "CONN.FAILED": "failed" } },
            failed: { on: { "CONN.CONNECTING": "connecting" } },
          },
        },
        voice: {
          initial: "live",
          states: { live: {}, backup: {}, offline: {} },
          on: { "VOICE.LIVE": ".live", "VOICE.BACKUP": ".backup", "VOICE.OFFLINE": ".offline" },
        },
        agent: {
          initial: "idle",
          states: {
            idle: {},
            listening: {},
            thinking: {},
            speaking: {},
            paused: { initial: "user", states: { user: {}, typing: {} } },
          },
          on: {
            "AGENT.IDLE": ".idle",
            "AGENT.LISTENING": ".listening",
            "AGENT.THINKING": ".thinking",
            "AGENT.SPEAKING": ".speaking",
            "AGENT.PAUSED": ".paused.user",
            "AGENT.PAUSED_TYPING": ".paused.typing",
          },
        },
        input: {
          initial: "init",
          states: {
            init: {
              always: [
                { guard: ({ context }) => context.startInput === "text", target: "text" },
                { target: "voice" },
              ],
            },
            voice: { on: { "INPUT.TEXT": "text" } },
            text: { on: { "INPUT.VOICE": "voice" } },
          },
        },
        turnMode: {
          initial: "tapToTalk",
          states: {
            tapToTalk: { on: { "TURN_MODE.HANDS_FREE": "handsFree" } },
            handsFree: { on: { "TURN_MODE.TAP": "tapToTalk" } },
          },
        },
        presentation: {
          initial: "greeting",
          states: {
            greeting: {},
            narrating: {},
            answering: {},
            awaitingResume: {},
            finished: {},
          },
          on: {
            "PRESENTATION.GREETING": ".greeting",
            "PRESENTATION.NARRATING": ".narrating",
            "PRESENTATION.ANSWERING": ".answering",
            "PRESENTATION.AWAITING_RESUME": ".awaitingResume",
            "PRESENTATION.FINISHED": ".finished",
          },
        },
      },
    },
    // Connections closed, microphone released, timers cancelled (End or time limit).
    ended: { on: { RESTART: { target: "setup", actions: assign({ error: null, slow: false }) } } },
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;

const region = <T extends string>(snap: SessionSnapshot, name: string, fallback: T): T => {
  const v = snap.value;
  if (typeof v !== "object" || !("live" in v)) return fallback;
  const live = v.live as Record<string, unknown>;
  const r = live[name];
  if (typeof r === "string") return r as T;
  if (r && typeof r === "object") {
    // agent.paused.{user,typing}
    const [k, sub] = Object.entries(r)[0] ?? [];
    return (k === "paused" && sub === "typing" ? "pausedTyping" : k) as T;
  }
  return fallback;
};

export function screenOf(
  snap: SessionSnapshot,
): "landing" | "micCheck" | "ready" | "live" | "ended" {
  if (snap.matches("ended")) return "ended";
  if (snap.matches("live")) return "live";
  if (snap.matches({ setup: "micCheck" })) return "micCheck";
  if (snap.matches({ setup: "ready" })) return "ready";
  return "landing";
}

export function toStatusSnapshot(snap: SessionSnapshot): StatusSnapshot {
  const live = snap.matches("live");
  return {
    ended: snap.matches("ended"),
    connection: live ? region(snap, "connection", "connecting") : "idle",
    voice: region(snap, "voice", "live"),
    agent: region(snap, "agent", "idle"),
    input: region<string>(snap, "input", "voice") === "text" ? "text" : "voice",
    turnMode: region(snap, "turnMode", "tapToTalk"),
    presentation: region(snap, "presentation", "greeting"),
    error: snap.context.error,
    slow: snap.context.slow,
  };
}

export interface Controls {
  talk: boolean;
  ask: boolean;
  pause: boolean;
  navigate: boolean;
  end: boolean;
  retry: boolean;
}

/** Which controls are enabled, from machine state only. */
export function controlsOf(s: StatusSnapshot): Controls {
  const live = !s.ended && s.connection !== "idle";
  const connected = s.connection === "connected";
  return {
    talk: live && connected && s.input === "voice" && s.voice === "live",
    ask: live && (connected || s.voice === "backup") && s.voice !== "offline",
    pause: live,
    navigate: live,
    end: live,
    retry: live && (s.error !== null || s.connection === "failed"),
  };
}
