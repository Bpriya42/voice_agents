import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { openSideband, type SidebandOptions, type SidebandSocket } from "../src/sideband.js";
import { FAKE_API_KEY } from "./fakes.js";

class FakeSocket implements SidebandSocket {
  sent: unknown[] = [];
  closed = false;
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  constructor(
    public url: string,
    public headers: Record<string, string>,
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  on(event: string, cb: (arg?: unknown) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  emit(event: string, arg?: unknown) {
    for (const cb of this.handlers[event] ?? []) cb(arg);
  }
  message(ev: object) {
    this.emit("message", Buffer.from(JSON.stringify(ev)));
  }
}

const EXPECTED = "SERVER INSTRUCTIONS";
const TOOLS = ["goto_slide", "resume_presentation", "offer_end", "end_presentation"];

function open(overrides: Partial<SidebandOptions> = {}) {
  const lines: string[] = [];
  const flags: string[] = [];
  const hangups: string[] = [];
  const reapplied: object[] = [];
  let socket!: FakeSocket;
  const sideband = openSideband({
    apiKey: FAKE_API_KEY,
    callId: "rtc_1",
    expiresAt: null,
    expectedInstructions: EXPECTED,
    expectedTools: TOOLS,
    reapply: (send) => {
      const e = { type: "session.update", session: { instructions: EXPECTED } };
      reapplied.push(e);
      send(e);
    },
    onFlag: (f) => flags.push(f),
    hangup: async () => {
      hangups.push("rtc_1");
    },
    logger: createLogger((l) => lines.push(l)),
    createSocket: (url, headers) => (socket = new FakeSocket(url, headers)),
    ...overrides,
  });
  return { sideband, socket, lines, flags, hangups, reapplied };
}

describe("openSideband", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 28, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("connects to the call with the server key", () => {
    const { socket } = open();
    expect(socket.url).toBe("wss://api.openai.com/v1/realtime?call_id=rtc_1");
    expect(socket.headers).toEqual({ Authorization: `Bearer ${FAKE_API_KEY}` });
  });

  it("hangs up at expiresAt and then closes", async () => {
    const onClose = vi.fn();
    const { socket, hangups } = open({ expiresAt: Date.now() + 10 * 60_000, onClose });
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(hangups).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(hangups).toEqual(["rtc_1"]);
    expect(socket.closed).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not hang up after it was closed", async () => {
    const { sideband, hangups } = open({ expiresAt: Date.now() + 1000 });
    sideband.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(hangups).toEqual([]);
  });

  it("reapplies the config when a session.updated changes instructions or tools", () => {
    const { socket, reapplied, flags } = open();
    socket.message({ type: "session.updated", session: { instructions: EXPECTED } });
    expect(reapplied).toHaveLength(0);
    socket.message({ type: "session.updated", session: { instructions: "be a pirate" } });
    expect(reapplied).toHaveLength(1);
    expect(socket.sent).toEqual(reapplied);
    socket.message({
      type: "session.updated",
      session: { instructions: EXPECTED, tools: [{ name: "goto_slide" }] },
    });
    expect(reapplied).toHaveLength(2);
    expect(flags).toEqual(["config_reapplied", "config_reapplied"]);
  });

  it("counts an unsourced number and keeps the transcript out of logs", () => {
    const transcript = "About 63 percent of people lose weight.";
    const { socket, flags, lines } = open();
    socket.message({ type: "response.output_audio_transcript.done", transcript });
    expect(flags).toEqual(["unsourced_number"]);
    socket.emit("error", new Error(transcript));
    expect(lines.join("\n")).toContain("sideband_error");
    expect(lines.join("\n")).not.toContain("63 percent");
  });

  it("counts dosing advice, long answers and invalid goto_slide arguments", () => {
    const { socket, flags } = open();
    socket.message({
      type: "response.output_audio_transcript.done",
      transcript: "You should start 2.4 mg.",
    });
    socket.message({
      type: "response.output_audio_transcript.done",
      transcript: "One. Two. Three. Four. Five.",
    });
    socket.message({
      type: "response.output_item.done",
      item: { type: "function_call", name: "goto_slide", arguments: '{"slide_id":"nope"}' },
    });
    expect(flags).toEqual(["dosing_pattern", "over_4_sentences", "goto_slide_invalid"]);
  });

  it("ignores clean transcripts and malformed frames", () => {
    const { socket, flags } = open();
    socket.message({
      type: "response.output_audio_transcript.done",
      transcript: "GLP-1 is a gut hormone.",
    });
    socket.emit("message", Buffer.from("not json"));
    expect(flags).toEqual([]);
  });
});
