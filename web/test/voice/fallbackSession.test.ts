import { describe, expect, it } from "vitest";
import { deck, greetingLine, type PersonaId } from "@ava/shared";
import type { ApiResult, ChatAnswer, ChatInput } from "../../src/api/client.js";
import { FallbackSpeechSession } from "../../src/voice/fallback/FallbackSpeechSession.js";
import type { ResponseRequest, VoiceEvent } from "../../src/voice/types.js";
import { FakeSpeech, makeUtterance } from "./fakeSpeech.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function make(
  opts: {
    mode?: "backup" | "local";
    speech?: FakeSpeech | null;
    chat?: (i: ChatInput) => Promise<ApiResult<ChatAnswer>>;
    persona?: PersonaId;
  } = {},
) {
  const speech = opts.speech === undefined ? new FakeSpeech() : opts.speech;
  const chatCalls: ChatInput[] = [];
  const chat =
    opts.chat ??
    (async (i: ChatInput): Promise<ApiResult<ChatAnswer>> => {
      chatCalls.push(i);
      return { ok: true, data: { answer: "The answer." } };
    });
  const mode = opts.mode ?? "backup";
  const session = new FallbackSpeechSession(7, {
    mode,
    speech,
    makeUtterance,
    ...(mode === "backup" ? { chat } : {}),
    context: {
      displayedSlide: () => "mechanism",
      history: () => [{ q: "old q", a: "old a" }],
      persona: opts.persona ?? "ava",
    },
  });
  const events: VoiceEvent[] = [];
  session.on((e) => events.push(e));
  const types = () => events.map((e) => e.type);
  const req = (over: Partial<ResponseRequest>): ResponseRequest => ({
    requestId: "r1",
    turnId: null,
    kind: "narration",
    instructions: "",
    toolChoice: "none",
    outOfBand: true,
    ...over,
  });
  return { session, speech, events, types, req, chatCalls };
}

describe("FallbackSpeechSession", () => {
  it("narration speaks the sentence script directly and maps the utterance lifecycle", async () => {
    const { session, speech, events, types, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    expect(speech!.last().text).toBe(deck[0]!.segments[0]!.text);
    expect(types()).toEqual(["generation_started", "generation_done"]);
    speech!.start();
    speech!.end();
    expect(types()).toEqual([
      "generation_started",
      "generation_done",
      "playback_started",
      "agent_transcript",
      "agent_transcript",
      "playback_completed",
    ]);
    expect(events.every((e) => e.sessionEpoch === 7)).toBe(true);
    // Generation completing is not playback completion: it was reported before speech started.
    expect(events.find((e) => e.type === "generation_done")).toMatchObject({
      status: "completed",
      hadAudio: true,
    });
  });

  it("a bridge leads the narration sentence", async () => {
    const { session, speech, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0, bridge: "reconnect" }));
    await tick();
    expect(speech!.last().text.startsWith("We're back.")).toBe(true);
  });

  it("the greeting is the fixed text-mode line", async () => {
    const { session, speech, req } = make();
    session.createResponse(req({ kind: "greeting" }));
    await tick();
    expect(speech!.last().text).toBe(greetingLine({ textOnly: true }));
  });

  it("the greeting and backup answers use the chosen presenter", async () => {
    const { session, speech, req, chatCalls } = make({ persona: "mira" });
    session.createResponse(req({ kind: "greeting" }));
    await tick();
    expect(speech!.last().text).toBe(greetingLine({ textOnly: true, persona: "mira" }));
    expect(speech!.last().text).toContain("I'm Mira.");
    session.sendUserText("What is it?");
    session.createResponse(req({ requestId: "r2", kind: "answer", turnId: "t1" }));
    await tick();
    expect(chatCalls[0]).toMatchObject({ persona: "mira" });
  });

  it("an answer comes from /api/chat with the displayed slide and history, then is spoken", async () => {
    const { session, speech, types, req, chatCalls } = make();
    session.sendUserText("What is it?");
    session.createResponse(req({ kind: "answer", turnId: "t1", toolChoice: "auto" }));
    await tick();
    expect(chatCalls).toEqual([
      {
        question: "What is it?",
        slideId: "mechanism",
        history: [{ q: "old q", a: "old a" }],
        persona: "ava",
      },
    ]);
    expect(speech!.last().text).toBe("The answer.");
    expect(types()).toContain("generation_done");
  });

  it("emits goto_slide and resume as tool calls before the answer is spoken", async () => {
    const { session, events, req } = make({
      chat: async () => ({
        ok: true,
        data: { answer: "See safety.", goto_slide: { slide_id: "safety", intent: "answer" } },
      }),
    });
    session.sendUserText("side effects?");
    session.createResponse(req({ kind: "answer", turnId: "t1" }));
    await tick();
    const tool = events.find((e) => e.type === "tool_call");
    expect(tool).toMatchObject({
      name: "goto_slide",
      args: { slide_id: "safety", intent: "answer" },
    });
    const iTool = events.findIndex((e) => e.type === "tool_call");
    const iText = events.findIndex((e) => e.type === "agent_transcript");
    expect(iTool).toBeLessThan(iText);
  });

  it("a failed chat call ends the response as failed with no audio", async () => {
    const { session, events, req } = make({
      chat: async () => ({ ok: false, code: "backend_unreachable" }),
    });
    session.createResponse(req({ kind: "answer", turnId: "t1" }));
    await tick();
    expect(events.at(-1)).toMatchObject({
      type: "generation_done",
      status: "failed",
      hadAudio: false,
    });
  });

  it("interrupt cancels speech at once, clears playback and never reports completion", async () => {
    const { session, speech, types, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    speech!.start();
    expect(await session.interrupt()).toBe("cleared");
    expect(speech!.cancels).toBeGreaterThan(0);
    speech!.end(); // the browser's late callback is ignored
    expect(types()).toContain("playback_cleared");
    expect(types()).not.toContain("playback_completed");
  });

  it("interrupting a pending chat call aborts it and reports a cancelled generation", async () => {
    let release!: (r: ApiResult<ChatAnswer>) => void;
    const { session, events, req } = make({
      chat: () => new Promise((r) => (release = r)),
    });
    session.createResponse(req({ kind: "answer", turnId: "t1" }));
    await tick();
    await session.interrupt();
    release({ ok: true, data: { answer: "late" } });
    await tick();
    expect(events.filter((e) => e.type === "generation_done")).toHaveLength(1);
    expect(events.find((e) => e.type === "generation_done")).toMatchObject({ status: "cancelled" });
    expect(events.some((e) => e.type === "agent_transcript")).toBe(false);
  });

  it("an interrupt before the response started still reports its generation as cancelled", async () => {
    const { session, events, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await session.interrupt();
    await tick();
    expect(events.map((e) => e.type)).toEqual(["generation_done"]);
  });

  it("a speech error reports audio_unavailable and clears playback instead of completing", async () => {
    const { session, speech, types, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    speech!.fail();
    expect(types()).toContain("audio_unavailable");
    expect(types()).toContain("playback_cleared");
    expect(types()).not.toContain("playback_completed");
    expect(session.canSpeak()).toBe(false);
  });

  it("with no speech engine the script is the caption and nothing plays", async () => {
    const { session, events, req } = make({ speech: null });
    expect(session.canSpeak()).toBe(false);
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    expect(events.find((e) => e.type === "agent_transcript")).toBeDefined();
    expect(events.find((e) => e.type === "generation_done")).toMatchObject({ hadAudio: false });
  });

  it("offline (local) mode speaks only with an on-device voice", async () => {
    const remote = make({
      mode: "local",
      speech: new FakeSpeech([{ localService: false, name: "r" }]),
    });
    expect(remote.session.canSpeak()).toBe(false);
    const local = make({
      mode: "local",
      speech: new FakeSpeech([
        { localService: false, name: "r" },
        { localService: true, name: "l" },
      ]),
    });
    expect(local.session.canSpeak()).toBe(true);
    local.session.createResponse(local.req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    expect(local.speech!.last().voice?.name).toBe("l");
  });

  it("offline mode has no answers: a question fails cleanly", async () => {
    const { session, events, req } = make({ mode: "local" });
    session.createResponse(req({ kind: "answer", turnId: "t1" }));
    await tick();
    expect(events.at(-1)).toMatchObject({ type: "generation_done", status: "failed" });
  });

  it("close cancels speech and ignores late callbacks", async () => {
    const { session, speech, events, req } = make();
    session.createResponse(req({ slideId: "intro", sentenceIndex: 0 }));
    await tick();
    session.close();
    const n = events.length;
    speech!.start();
    speech!.end();
    expect(events.length).toBe(n);
    expect(speech!.cancels).toBeGreaterThan(0);
  });
});
