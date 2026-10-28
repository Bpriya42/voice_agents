import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { controlsOf, screenOf, sessionMachine, toStatusSnapshot } from "./session.js";

const start = (input: "voice" | "text" = "voice") => {
  const a = createActor(sessionMachine).start();
  a.send({ type: "START", input });
  return a;
};
const status = (a: ReturnType<typeof start>) => toStatusSnapshot(a.getSnapshot());

describe("session machine", () => {
  it("setup: landing → micCheck → ready, or straight to ready by typing", () => {
    const a = createActor(sessionMachine).start();
    expect(screenOf(a.getSnapshot())).toBe("landing");
    a.send({ type: "SETUP.MIC_CHECK" });
    expect(screenOf(a.getSnapshot())).toBe("micCheck");
    a.send({ type: "SETUP.BACK" });
    a.send({ type: "SETUP.READY" });
    expect(screenOf(a.getSnapshot())).toBe("ready");
    expect(toStatusSnapshot(a.getSnapshot()).connection).toBe("idle");
  });

  it("starts live in connecting with the chosen input", () => {
    expect(status(start("voice"))).toMatchObject({
      connection: "connecting",
      input: "voice",
      agent: "idle",
      presentation: "greeting",
    });
    expect(status(start("text")).input).toBe("text");
  });

  it("parallel regions move independently", () => {
    const a = start();
    a.send({ type: "CONN.CONNECTED" });
    a.send({ type: "AGENT.SPEAKING" });
    a.send({ type: "PRESENTATION.NARRATING" });
    a.send({ type: "INPUT.TEXT", reason: "mic_lost" });
    expect(status(a)).toMatchObject({
      connection: "connected",
      agent: "speaking",
      presentation: "narrating",
      input: "text",
    });
    a.send({ type: "AGENT.PAUSED_TYPING" });
    expect(status(a).agent).toBe("pausedTyping");
    a.send({ type: "AGENT.PAUSED" });
    expect(status(a).agent).toBe("paused");
    a.send({ type: "VOICE.OFFLINE" });
    a.send({ type: "TURN_MODE.HANDS_FREE" });
    expect(status(a)).toMatchObject({ voice: "offline", turnMode: "handsFree" });
  });

  it("errors and the slow flag live in context", () => {
    const a = start();
    a.send({ type: "ERROR.SET", code: "response_timeout" });
    a.send({ type: "SLOW.SET", slow: true });
    expect(status(a)).toMatchObject({ error: "response_timeout", slow: true });
    a.send({ type: "ERROR.CLEAR" });
    expect(status(a).error).toBeNull();
  });

  it("connection: lost → reconnecting → connected; failed → connecting on retry", () => {
    const a = start();
    a.send({ type: "CONN.CONNECTED" });
    a.send({ type: "CONN.LOST" });
    expect(status(a).connection).toBe("reconnecting");
    a.send({ type: "CONN.FAILED" });
    expect(status(a).connection).toBe("failed");
    a.send({ type: "CONN.CONNECTING" });
    expect(status(a).connection).toBe("connecting");
  });

  it("END from any live state; RESTART returns to setup", () => {
    const a = start();
    a.send({ type: "CONN.FAILED" });
    a.send({ type: "END" });
    expect(screenOf(a.getSnapshot())).toBe("ended");
    expect(status(a).ended).toBe(true);
    a.send({ type: "RESTART" });
    expect(screenOf(a.getSnapshot())).toBe("landing");
  });

  it("controls: talk needs a connected live voice and a mic; ask needs a connection", () => {
    const a = start();
    expect(controlsOf(status(a))).toMatchObject({
      talk: false,
      ask: false,
      end: true,
      navigate: true,
      retry: false,
    });
    a.send({ type: "CONN.CONNECTED" });
    expect(controlsOf(status(a))).toMatchObject({ talk: true, ask: true });
    a.send({ type: "INPUT.TEXT" });
    expect(controlsOf(status(a))).toMatchObject({ talk: false, ask: true });
    a.send({ type: "VOICE.OFFLINE" });
    expect(controlsOf(status(a)).ask).toBe(false);
    a.send({ type: "ERROR.SET", code: "server_error" });
    expect(controlsOf(status(a)).retry).toBe(true);
    a.send({ type: "END" });
    expect(controlsOf(status(a))).toMatchObject({ talk: false, ask: false, end: false });
  });
});
