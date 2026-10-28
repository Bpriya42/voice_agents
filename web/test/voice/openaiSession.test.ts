import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIRealtimeSession,
  type RealtimeDeps,
} from "../../src/voice/openai/OpenAIRealtimeSession.js";
import { CALLS_URL } from "../../src/voice/openai/events.js";
import type { ResponseRequest, VoiceEvent } from "../../src/voice/types.js";
import { FakeGate, FakePeerConnection, fakeMic } from "./fakeWebRTC.js";

// A made-up value: tests never use a real key.
const SECRET = "test-client-secret-not-real";

function setup({ hosted = false, ok = true } = {}) {
  const pc = new FakePeerConnection();
  const gate = new FakeGate();
  const reportCall = vi.fn(async () => {});
  const fetchMock = vi.fn(
    async () =>
      new Response(ok ? "v=0 fake-answer" : "nope", {
        status: ok ? 201 : 500,
        headers: { Location: "/v1/realtime/calls/rtc_call_123" },
      }),
  );
  const deps: RealtimeDeps = {
    api: {
      startSession: vi.fn(async () => ({
        clientSecret: SECRET,
        sessionId: "sess-1",
        expiresAt: null,
      })),
      reportCall,
    },
    fetch: fetchMock as unknown as typeof fetch,
    createPeerConnection: () => pc as unknown as RTCPeerConnection,
    createGate: () => gate,
    hosted,
  };
  const s = new OpenAIRealtimeSession(3, deps);
  const events: VoiceEvent[] = [];
  s.on((e) => events.push(e));
  const dc = pc.channel;
  const req = (requestId: string, over: Partial<ResponseRequest> = {}): ResponseRequest => ({
    requestId,
    turnId: null,
    kind: "narration",
    instructions: "say it",
    toolChoice: "none",
    outOfBand: true,
    ...over,
  });
  const created = (requestId: string, rid: string) =>
    dc.deliver({ type: "response.created", response: { id: rid, metadata: { requestId } } });
  const done = (rid: string, status = "completed", audio = true) =>
    dc.deliver({
      type: "response.done",
      response: {
        id: rid,
        status,
        output: audio
          ? [{ id: `item_${rid}`, type: "message", content: [{ type: "output_audio" }] }]
          : [],
      },
    });
  const of = <T extends VoiceEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<VoiceEvent, { type: T }> => e.type === type);
  return { s, pc, dc, gate, deps, fetchMock, reportCall, events, req, created, done, of };
}

async function connected(opts?: Parameters<typeof setup>[0], mic = fakeMic()) {
  const t = setup(opts);
  await t.s.connect({ mic: mic.stream });
  t.pc.fireTrack({} as MediaStream);
  return { ...t, mic };
}

afterEach(() => vi.useRealTimers());

describe("OpenAIRealtimeSession.connect", () => {
  it("posts the SDP with the client secret, reports the call when hosted, and never stores the secret", async () => {
    const { s, fetchMock, reportCall, of, mic, pc } = await connected({ hosted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CALLS_URL);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${SECRET}`);
    expect(init.body).toBe("v=0 fake-offer");
    expect(pc.remote).toEqual({ type: "answer", sdp: "v=0 fake-answer" });
    expect(reportCall).toHaveBeenCalledWith("sess-1", "rtc_call_123");
    expect(of("connected")).toHaveLength(1);
    expect(of("connected")[0]!.sessionEpoch).toBe(3);
    expect(Object.values(s)).not.toContain(SECRET);
    expect(JSON.stringify(Object.entries(s).map(([k]) => k))).not.toContain(SECRET);
    // The mic is added but disabled until a turn is held.
    expect(pc.tracks).toHaveLength(1);
    expect(mic.track.enabled).toBe(false);
  });

  it("does not report the call when running locally", async () => {
    const { reportCall } = await connected({ hosted: false });
    expect(reportCall).not.toHaveBeenCalled();
  });

  it("adds a recvonly transceiver without a mic", async () => {
    const t = setup();
    await t.s.connect({ mic: null });
    expect(t.pc.tracks).toHaveLength(0);
    expect(t.pc.transceivers).toEqual([{ kind: "audio", init: { direction: "recvonly" } }]);
  });

  it("fails with session_failed when the SDP exchange fails", async () => {
    const t = setup({ ok: false });
    await expect(t.s.connect({ mic: null })).rejects.toMatchObject({ code: "session_failed" });
  });
});

describe("event normalization", () => {
  it("response.created with metadata emits generation_started with both ids and the epoch", async () => {
    const { s, req, created, of } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    expect(of("generation_started")).toEqual([
      { type: "generation_started", requestId: "q1", responseId: "resp_1", sessionEpoch: 3 },
    ]);
  });

  it("sends response.create with metadata, tool choice, conversation none and empty input for narration", async () => {
    const { s, dc, req } = await connected();
    s.createResponse(req("q1", { turnId: "t1", kind: "narration" }));
    expect(dc.sent.at(-1)).toEqual({
      type: "response.create",
      response: {
        conversation: "none",
        input: [],
        instructions: "say it",
        tool_choice: "none",
        metadata: { requestId: "q1", epoch: "3", turnId: "t1", kind: "narration" },
      },
    });
    s.createResponse(req("q2", { kind: "answer", outOfBand: false, toolChoice: "auto" }));
    expect(dc.sent.at(-1)!["response"]).not.toHaveProperty("conversation");
    expect(dc.sent.at(-1)!["response"]).not.toHaveProperty("input");
  });

  it("response.done emits generation_done and not playback_completed", async () => {
    const { s, req, created, done, of } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    done("resp_1");
    expect(of("generation_done")).toMatchObject([
      {
        requestId: "q1",
        responseId: "resp_1",
        status: "completed",
        hadAudio: true,
        outputItemIds: ["item_resp_1"],
      },
    ]);
    expect(of("playback_completed")).toHaveLength(0);
  });

  it("output_audio_buffer.stopped emits playback_completed only after the gate reads silence", async () => {
    const { s, dc, gate, req, created, done, of } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    dc.deliver({ type: "output_audio_buffer.started", response_id: "resp_1" });
    done("resp_1");
    dc.deliver({ type: "output_audio_buffer.stopped", response_id: "resp_1" });
    await Promise.resolve();
    expect(of("playback_started")).toHaveLength(1);
    expect(of("playback_completed")).toHaveLength(0);
    gate.silence();
    await Promise.resolve();
    expect(of("playback_completed")).toEqual([
      { type: "playback_completed", responseId: "resp_1", sessionEpoch: 3 },
    ]);
  });

  it("attributes buffer events without response_id to the oldest unplayed response", async () => {
    const { s, dc, req, created, of } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    dc.deliver({
      type: "response.output_audio_transcript.delta",
      response_id: "resp_1",
      delta: "Hi",
    });
    dc.deliver({ type: "output_audio_buffer.started" });
    expect(of("playback_started")).toEqual([
      { type: "playback_started", responseId: "resp_1", sessionEpoch: 3 },
    ]);
    dc.deliver({ type: "output_audio_buffer.cleared" });
    expect(of("playback_cleared")[0]!.responseId).toBe("resp_1");
  });

  it("normalizes tool calls, transcripts and input commits", async () => {
    const { s, dc, req, created, of } = await connected();
    s.createResponse(req("q1", { kind: "answer" }));
    created("q1", "resp_1");
    dc.deliver({
      type: "response.function_call_arguments.done",
      response_id: "resp_1",
      call_id: "call_1",
      name: "goto_slide",
      arguments: '{"slide_id":"safety","intent":"answer"}',
    });
    dc.deliver({
      type: "response.output_audio_transcript.delta",
      response_id: "resp_1",
      delta: "Hello",
    });
    dc.deliver({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "u1",
      transcript: "Hi there",
    });
    s.beginUserTurn("turn-1");
    dc.deliver({ type: "input_audio_buffer.committed", item_id: "u2" });
    expect(of("tool_call")[0]).toMatchObject({
      requestId: "q1",
      responseId: "resp_1",
      callId: "call_1",
      name: "goto_slide",
      args: { slide_id: "safety", intent: "answer" },
    });
    expect(of("agent_transcript")[0]).toMatchObject({
      responseId: "resp_1",
      delta: "Hello",
      final: false,
    });
    expect(of("user_transcript")[0]).toMatchObject({ itemId: "u1", text: "Hi there", final: true });
    expect(of("user_input_committed")[0]).toMatchObject({ turnId: "turn-1", itemId: "u2" });
  });

  it("swallows expected protocol errors and surfaces others", async () => {
    const { dc, of } = await connected();
    dc.deliver({ type: "error", error: { code: "response_cancel_not_active", message: "x" } });
    expect(of("error")).toHaveLength(0);
    dc.deliver({ type: "error", error: { code: "something_else", message: "boom" } });
    expect(of("error")).toMatchObject([{ code: "server_error", fatal: false }]);
  });

  it("reports a closed data channel and a failed peer as disconnects", async () => {
    vi.useFakeTimers();
    const { pc, of } = await connected();
    pc.setState("disconnected");
    vi.advanceTimersByTime(2999);
    expect(of("disconnected")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(of("disconnected")).toEqual([
      { type: "disconnected", reason: "network", sessionEpoch: 3 },
    ]);
  });

  it("emits mic_ended when the track ends", async () => {
    const { mic, of } = await connected();
    mic.track.fire("ended");
    expect(of("mic_ended")).toHaveLength(1);
  });
});

describe("interrupt", () => {
  it("mutes first, sends cancel then clear, and resolves cleared after both acknowledgements", async () => {
    const { s, dc, gate, req, created } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    dc.deliver({ type: "output_audio_buffer.started", response_id: "resp_1" });
    const before = dc.sent.length;
    let result: string | null = null;
    void s.interrupt().then((r) => (result = r));
    expect(gate.gains.at(-1)).toBe(0);
    expect(dc.types().slice(before)).toEqual(["response.cancel", "output_audio_buffer.clear"]);
    dc.deliver({
      type: "response.done",
      response: { id: "resp_1", status: "cancelled", output: [] },
    });
    await Promise.resolve();
    expect(result).toBeNull();
    dc.deliver({ type: "output_audio_buffer.cleared", response_id: "resp_1" });
    await vi.waitFor(() => expect(result).toBe("cleared"));
  });

  it("cancels a request whose response.created has not arrived yet", async () => {
    const { s, dc, req } = await connected();
    s.createResponse(req("q1"));
    const before = dc.sent.length;
    void s.interrupt();
    expect(dc.types().slice(before)).toEqual(["response.cancel"]);
  });

  it("cancels by response_id, which out-of-band responses need (spike S)", async () => {
    const { s, dc, req, created } = await connected();
    s.createResponse({ ...req("q1"), outOfBand: true });
    created("q1", "resp_1");
    const before = dc.sent.length;
    void s.interrupt();
    expect(dc.sent.slice(before)).toContainEqual({
      type: "response.cancel",
      response_id: "resp_1",
    });
  });

  it("cancels by id on creation a request interrupted before response.created", async () => {
    const { s, dc, req, created } = await connected();
    s.createResponse({ ...req("q1"), outOfBand: true });
    void s.interrupt();
    const before = dc.sent.length;
    created("q1", "resp_1");
    expect(dc.sent.slice(before)).toContainEqual({
      type: "response.cancel",
      response_id: "resp_1",
    });
  });

  it("resolves timeout after 1.5 s without acknowledgements", async () => {
    const { s, req, created } = await connected();
    vi.useFakeTimers();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    const p = s.interrupt();
    vi.advanceTimersByTime(1500);
    await expect(p).resolves.toBe("timeout");
  });

  it("with nothing active sends nothing", async () => {
    const { s, dc } = await connected();
    const before = dc.sent.length;
    await expect(s.interrupt()).resolves.toBe("cleared");
    expect(dc.sent.length).toBe(before);
  });

  it("clears late audio from a cancelled response on sight", async () => {
    const { s, dc, req, created } = await connected();
    s.createResponse(req("q1"));
    created("q1", "resp_1");
    void s.interrupt();
    dc.deliver({
      type: "response.done",
      response: { id: "resp_1", status: "completed", output: [] },
    });
    const before = dc.sent.length;
    dc.deliver({ type: "output_audio_buffer.started", response_id: "resp_1" });
    expect(dc.types().slice(before)).toEqual(["output_audio_buffer.clear"]);
  });
});

describe("user turns", () => {
  it("beginUserTurn clears input and enables the mic", async () => {
    const { s, dc, mic } = await connected();
    s.beginUserTurn("t1");
    expect(dc.types()).toContain("input_audio_buffer.clear");
    expect(mic.track.enabled).toBe(true);
  });

  it("endUserTurn({ cancel: true }) disables the mic and clears input without a commit", async () => {
    const { s, dc, mic } = await connected();
    s.beginUserTurn("t1");
    const before = dc.sent.length;
    await expect(s.endUserTurn({ cancel: true })).resolves.toEqual({ committed: false });
    expect(mic.track.enabled).toBe(false);
    expect(dc.types().slice(before)).toEqual(["input_audio_buffer.clear"]);
  });

  it("endUserTurn sends after a 150 ms tail and reports the committed item", async () => {
    const { s, dc, mic } = await connected();
    vi.useFakeTimers();
    s.beginUserTurn("t1");
    const p = s.endUserTurn({ cancel: false });
    vi.advanceTimersByTime(149);
    expect(dc.types()).not.toContain("input_audio_buffer.commit");
    expect(mic.track.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(dc.types()).toContain("input_audio_buffer.commit");
    expect(mic.track.enabled).toBe(false);
    dc.deliver({ type: "input_audio_buffer.committed", item_id: "item_u" });
    await expect(p).resolves.toEqual({ committed: true, itemId: "item_u" });
  });

  it("an empty commit resolves as not committed", async () => {
    const { s, dc } = await connected();
    vi.useFakeTimers();
    const p = s.endUserTurn({ cancel: false });
    await vi.advanceTimersByTimeAsync(150);
    dc.deliver({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "" } });
    await expect(p).resolves.toEqual({ committed: false });
  });

  it("close() during the tail never commits", async () => {
    const { s, dc } = await connected();
    vi.useFakeTimers();
    const p = s.endUserTurn({ cancel: false });
    s.close();
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual({ committed: false });
    expect(dc.types()).not.toContain("input_audio_buffer.commit");
  });
});

describe("conversation hygiene and close", () => {
  it("sends user text, tool results, notes and deletes as conversation items", async () => {
    const { s, dc } = await connected();
    const u = s.sendUserText("Hello?");
    const o = s.sendToolResult("call_1", { ok: true });
    const n = await s.addControllerNote("Presented slide 1.");
    s.deleteItems([u, n]);
    expect(dc.sent.slice(-5)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          id: u,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello?" }],
        },
      },
      {
        type: "conversation.item.create",
        item: { id: o, type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
      },
      {
        type: "conversation.item.create",
        item: {
          id: n,
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "Presented slide 1." }],
        },
      },
      { type: "conversation.item.delete", item_id: u },
      { type: "conversation.item.delete", item_id: n },
    ]);
    expect(u.length).toBeLessThanOrEqual(32);
  });

  it("replaceMic swaps the sender track and stops the old one", async () => {
    const { s, pc, mic } = await connected();
    const next = fakeMic().track;
    await s.replaceMic(next as unknown as MediaStreamTrack);
    expect(pc.replaced).toEqual([next]);
    expect(mic.track.stopped).toBe(true);
  });

  it("close() twice is safe and nothing is emitted afterwards", async () => {
    const { s, dc, pc, gate, events } = await connected();
    s.close();
    s.close();
    expect(pc.closed).toBe(true);
    expect(gate.closed).toBe(true);
    const n = events.length;
    dc.deliver({ type: "response.created", response: { id: "r", metadata: { requestId: "q" } } });
    expect(events.length).toBe(n);
  });
});
