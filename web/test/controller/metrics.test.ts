import { afterEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.js";

afterEach(() => vi.useRealTimers());

describe("controller latency metrics (arch §7)", () => {
  it("measures the greeting from the Start click to the first audible frame", async () => {
    const h = setup();
    await h.ctl.start(h.mic());
    await vi.advanceTimersByTimeAsync(200);
    h.startPlaying(h.last().requestId);
    await vi.advanceTimersByTimeAsync(100);
    const g = h.ctl.metrics.summary().greeting!;
    expect(g.n).toBe(1);
    expect(g.p50).toBeGreaterThanOrEqual(200);
    expect(g.p50).toBeLessThanOrEqual(260);
  });

  it("measures typed answer latency from send to the first audible frame", async () => {
    const h = setup();
    await h.started();
    const req = await h.typed("What are the side effects?");
    await vi.advanceTimersByTimeAsync(300);
    h.startPlaying(req.requestId);
    await vi.advanceTimersByTimeAsync(100);
    const m = h.ctl.metrics.summary().typedLatency!;
    expect(m.n).toBe(1);
    expect(m.p50).toBeGreaterThanOrEqual(300);
    expect(m.p50).toBeLessThanOrEqual(360);
  });

  it("measures spoken answer latency from release", async () => {
    const h = setup();
    await h.started();
    const req = await h.spoken(600);
    await vi.advanceTimersByTimeAsync(250);
    h.startPlaying(req.requestId);
    await vi.advanceTimersByTimeAsync(100);
    const m = h.ctl.metrics.summary().answerLatency!;
    expect(m.n).toBe(1);
    expect(m.p50).toBeGreaterThanOrEqual(250);
    expect(m.p50).toBeLessThanOrEqual(320);
  });

  it("measures the narration gap from playback_completed to the next audible frame", async () => {
    const h = setup();
    await h.started();
    const first = h.last();
    h.startPlaying(first.requestId);
    h.voice().generationDone(first.requestId, "completed", { hadAudio: true });
    await vi.advanceTimersByTimeAsync(100);
    h.voice().playbackCompleted(first.requestId);
    await h.flush();
    const next = h.last();
    expect(next.requestId).not.toBe(first.requestId);
    await vi.advanceTimersByTimeAsync(400);
    h.startPlaying(next.requestId);
    await vi.advanceTimersByTimeAsync(100);
    const m = h.ctl.metrics.summary().narrationGap!;
    expect(m.n).toBe(1);
    expect(m.p50).toBeGreaterThanOrEqual(400);
    expect(m.p50).toBeLessThanOrEqual(460);
  });

  it("measures barge-in from the press to silent output", async () => {
    const h = setup();
    await h.started();
    h.startPlaying(h.last().requestId);
    await vi.advanceTimersByTimeAsync(100);
    h.ctl.talkDown();
    h.voice().ackInterrupt();
    await vi.advanceTimersByTimeAsync(300);
    const m = h.ctl.metrics.summary().bargeIn!;
    expect(m.n).toBe(1);
    expect(m.p50).toBeLessThan(60);
  });

  it("does not time a barge-in when nothing was audible", async () => {
    const h = setup();
    await h.started();
    await vi.advanceTimersByTimeAsync(100);
    h.ctl.talkDown();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.ctl.metrics.summary().bargeIn).toBeUndefined();
  });

  it("an interrupt cancels a running narration-gap measurement", async () => {
    const h = setup();
    await h.started();
    const first = h.last();
    h.play(first.requestId);
    await h.flush();
    await h.ctl.askTyped("Hello?");
    h.voice().ackInterrupt();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.ctl.metrics.isRunning("narrationGap")).toBe(false);
    expect(h.ctl.metrics.summary().narrationGap).toBeUndefined();
  });

  it("counts dropped stale events and reports metrics once on End", async () => {
    const reported: [string, unknown][] = [];
    const h = setup({ onMetrics: (id, m) => reported.push([id, m]) });
    await h.started();
    h.voice().emitStale({ type: "playback_completed", responseId: "old" });
    expect(h.ctl.debugSnapshot().staleEvents).toBe(1);
    h.ctl.end();
    h.ctl.end();
    expect(reported).toHaveLength(1);
    expect(reported[0]![0]).toBe("sess-1");
  });

  it("tracks conversation tokens from answer responses only", async () => {
    const h = setup();
    await h.started();
    const req = await h.typed("What are the side effects?");
    h.voice().generationStarted(req.requestId);
    h.voice().generationDone(req.requestId, "completed", {
      hadAudio: true,
      usage: { totalTokens: 1234 },
    });
    expect(h.ctl.debugSnapshot().conversationTokens).toBe(1234);
  });
});
