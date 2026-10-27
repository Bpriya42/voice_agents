import { describe, expect, it } from "vitest";
import { ERROR_COPY, orbState, statusLabel, type StatusSnapshot } from "./status.js";

const base: StatusSnapshot = {
  ended: false,
  connection: "connected",
  voice: "live",
  agent: "idle",
  input: "voice",
  turnMode: "tapToTalk",
  presentation: "narrating",
  error: null,
  slow: false,
};
const label = (over: Partial<StatusSnapshot>) => statusLabel({ ...base, ...over }).label;

describe("statusLabel priority (arch §4.5)", () => {
  it("ended beats everything", () => {
    expect(label({ ended: true, connection: "reconnecting", error: "mic_lost" })).toBe(
      "Thanks for listening",
    );
  });

  it("connecting and reconnecting beat errors", () => {
    expect(label({ connection: "connecting", error: "response_timeout" })).toBe("Connecting…");
    expect(label({ connection: "reconnecting", agent: "speaking" })).toBe(
      "Connection lost — reconnecting…",
    );
  });

  it("an error shows its copy with the error tone", () => {
    expect(statusLabel({ ...base, error: "demo_busy", agent: "speaking" })).toEqual({
      label: ERROR_COPY.demo_busy,
      tone: "error",
    });
    expect(label({ connection: "failed" })).toBe("Can't connect to the voice service.");
  });

  it("offline beats agent states", () => {
    expect(label({ voice: "offline", agent: "speaking" })).toBe(
      "You're offline — questions are paused",
    );
  });

  it("paused while typing beats paused, which beats speaking", () => {
    expect(label({ agent: "pausedTyping" })).toBe("Paused while you type");
    expect(label({ agent: "paused" })).toBe("Paused — press Resume or P");
  });

  it("speaking, thinking (slow), listening", () => {
    expect(label({ agent: "speaking" })).toBe("Speaking — hold Space to interrupt");
    expect(label({ agent: "thinking" })).toBe("Thinking…");
    expect(label({ agent: "thinking", slow: true })).toBe("Still working…");
    expect(label({ agent: "listening" })).toBe("Listening…");
  });

  it("finished, text mode and idle hints", () => {
    expect(label({ presentation: "finished" })).toBe("Any final questions? Hold Space");
    expect(label({ input: "text" })).toBe("Type your question below");
    expect(label({ voice: "backup" })).toBe("Type your question below");
    expect(label({})).toBe("Hold Space or tap to talk");
    expect(label({ turnMode: "handsFree" })).toBe("Listening for you…");
  });

  it("text-only modes never say hold Space", () => {
    for (const agent of ["idle", "speaking", "thinking", "listening"] as const) {
      for (const presentation of ["narrating", "finished"] as const) {
        expect(label({ input: "text", agent, presentation })).not.toMatch(/Space/);
        expect(label({ voice: "backup", agent, presentation })).not.toMatch(/Space/);
      }
    }
    expect(label({ input: "text", agent: "speaking" })).toBe("Speaking — type to interrupt");
    expect(label({ input: "text", presentation: "finished" })).toBe(
      "Any final questions? Type below",
    );
  });

  it("busy tone for connecting and thinking", () => {
    expect(statusLabel({ ...base, connection: "connecting" }).tone).toBe("busy");
    expect(statusLabel({ ...base, agent: "thinking" }).tone).toBe("busy");
    expect(statusLabel(base).tone).toBe("info");
  });
});

describe("orbState", () => {
  it("maps each state to a distinct visual", () => {
    expect(orbState({ ...base, ended: true })).toBe("ended");
    expect(orbState({ ...base, connection: "connecting" })).toBe("connecting");
    expect(orbState({ ...base, error: "server_error" })).toBe("error");
    expect(orbState({ ...base, agent: "speaking" })).toBe("speaking");
    expect(orbState({ ...base, agent: "listening" })).toBe("listening");
    expect(orbState({ ...base, agent: "thinking" })).toBe("thinking");
    expect(orbState({ ...base, agent: "pausedTyping" })).toBe("paused");
    expect(orbState({ ...base, input: "text" })).toBe("text");
    expect(orbState(base)).toBe("ready");
  });
});
