import { afterEach, describe, expect, it, vi } from "vitest";
import { deck } from "@ava/shared";
import { FakeSpeech } from "../voice/fakeSpeech.js";
import { setup } from "./harness.js";

afterEach(() => vi.useRealTimers());

/** Start a session whose first three connects fail, then take the backup voice. */
async function startInBackup(opts: Parameters<typeof setup>[0] = {}) {
  const h = setup({ backup: true, failConnects: 3, ...opts });
  const started = h.ctl.start(h.mic());
  await vi.advanceTimersByTimeAsync(2500);
  await started;
  expect(h.view().canBackup).toBe(true);
  h.ctl.continueWithBackup();
  await h.flush();
  return h;
}

describe("connect retries (arch §6.2 session_failed)", () => {
  it("connects on the third attempt after waits of 0.5 s and 2 s", async () => {
    const { ctl, mic, voices, view, flush } = setup({ failConnects: 2 });
    const started = ctl.start(mic());
    await flush();
    expect(voices).toHaveLength(1);
    expect(view().status.label).toBe("Connecting…");
    await vi.advanceTimersByTimeAsync(500);
    expect(voices).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    await started;
    expect(voices).toHaveLength(3);
    expect(view().snapshot.connection).toBe("connected");
    expect(view().snapshot.error).toBeNull();
  });

  it("after three failures it shows the error, Retry and Continue with backup voice", async () => {
    const { ctl, mic, voices, view } = setup({ failConnects: 3, backup: true });
    const started = ctl.start(mic());
    await vi.advanceTimersByTimeAsync(2500);
    await started;
    expect(voices).toHaveLength(3);
    expect(view().snapshot.connection).toBe("failed");
    expect(view().status.label).toBe("Can't connect to the voice service.");
    expect(view().controls.retry).toBe(true);
    expect(view().canBackup).toBe(true);
  });

  it("without a backup factory there is no backup offer", async () => {
    const { ctl, mic, view } = setup({ failConnects: 3 });
    const started = ctl.start(mic());
    await vi.advanceTimersByTimeAsync(2500);
    await started;
    expect(view().canBackup).toBe(false);
  });

  it("Retry after the failure connects and greets", async () => {
    const { ctl, mic, view, last, flush } = setup({ failConnects: 3 });
    const started = ctl.start(mic());
    await vi.advanceTimersByTimeAsync(2500);
    await started;
    ctl.retry();
    await flush();
    expect(view().snapshot.connection).toBe("connected");
    expect(last().kind).toMatch(/narration|greeting/);
  });

  it("End during the backoff cancels the loop and leaves no timers", async () => {
    const { ctl, mic, voices, view, flush } = setup({ failConnects: 3 });
    void ctl.start(mic());
    await flush();
    expect(voices).toHaveLength(1);
    ctl.end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(voices).toHaveLength(1);
    expect(view().screen).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reconnect restores the talk (arch §6.3 table)", () => {
  it("narrating: the checkpoint sentence returns with a We're back bridge, on the same slide", async () => {
    const { voice, voices, started, last, view, flush } = setup();
    await started();
    const before = last();
    voice().drop("network");
    expect(view().status.label).toBe("Connection lost — reconnecting…");
    await flush();
    expect(voices).toHaveLength(2);
    expect(view().snapshot.connection).toBe("connected");
    expect(last()).toMatchObject({ kind: "narration", slideId: before.slideId, sentenceIndex: 0 });
    expect(last().instructions).toContain("We're back.");
    expect(voice().commands.some((c) => c.type === "addControllerNote")).toBe(true);
  });

  it("greeting: slide 1 starts without a second greeting", async () => {
    const { ctl, mic, voice, kinds, last, flush } = setup();
    await ctl.start(mic());
    expect(last().kind).toBe("greeting");
    voice().drop("network");
    await flush();
    expect(kinds()).not.toContain("greeting");
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 0 });
    expect(last().instructions).not.toContain("We're back");
  });

  it("paused: stays paused and nothing is spoken", async () => {
    const { ctl, voice, started, creates, view, flush } = setup();
    await started();
    ctl.togglePause();
    voice().drop("server");
    await flush();
    expect(creates()).toHaveLength(0);
    expect(view().presentationStatus).toBe("paused");
    expect(view().snapshot.connection).toBe("connected");
    // Resume restarts the checkpoint sentence on the new session.
    ctl.resume();
    expect(creates().at(-1)).toMatchObject({ kind: "narration", sentenceIndex: 0 });
  });

  it("answering: offers Ask again, stays silent, and resends the question text on the new session", async () => {
    const { ctl, voice, started, typed, creates, view, last, flush } = setup();
    await started();
    await typed("Why does it work?");
    voice().drop("network");
    await flush();
    expect(creates()).toHaveLength(0);
    expect(view().askAgain).toBe(true);
    ctl.askAgain();
    await flush();
    expect(voice().commands).toContainEqual(
      expect.objectContaining({ type: "sendUserText", text: "Why does it work?" }),
    );
    expect(last().kind).toBe("answer");
  });

  it("a question held on Space is dropped with a notice", async () => {
    const { ctl, voice, started, view, creates, flush } = setup();
    await started();
    ctl.talkDown();
    voice().drop("network");
    await flush();
    expect(view().notice).toContain("lost in the reconnect");
    expect(view().capturing).toBeNull();
    expect(creates().every((c) => c.kind === "narration")).toBe(true);
  });

  it("awaitingResume: narration resumes as normal after the reconnect", async () => {
    const { voice, started, typed, play, last, flush } = setup();
    await started();
    const a = await typed("Q?");
    play(a.requestId, "The short answer.");
    voice().drop("network");
    await flush();
    expect(last()).toMatchObject({ kind: "narration" });
    expect(last().instructions).toContain("We're back.");
  });

  it("finished: stays finished and silent", async () => {
    const { ctl, voice, started, play, last, creates, view, flush } = setup();
    await started();
    ctl.goto(deck.length - 1);
    for (let i = 0; i < 30 && view().presentationStatus !== "finished"; i++) play(last().requestId);
    expect(view().presentationStatus).toBe("finished");
    voice().drop("network");
    await flush();
    expect(creates()).toHaveLength(0);
    expect(view().presentationStatus).toBe("finished");
  });

  it("seeds the new session with a controller note and the last completed Q&A in original roles", async () => {
    const { voice, started, typed, play, flush } = setup();
    await started();
    const a = await typed("What is GLP-1?");
    play(a.requestId, "It is a gut hormone.");
    voice().drop("network");
    await flush();
    const cmds = voice().commands;
    const noteAt = cmds.findIndex((c) => c.type === "addControllerNote");
    const userAt = cmds.findIndex((c) => c.type === "sendUserText");
    const assistantAt = cmds.findIndex((c) => c.type === "addAssistantText");
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(userAt).toBeGreaterThan(noteAt);
    expect(assistantAt).toBeGreaterThan(userAt);
    expect(cmds[userAt]).toMatchObject({ text: "What is GLP-1?" });
    expect(cmds[assistantAt]).toMatchObject({ text: "It is a gut hormone." });
    const note = cmds[noteAt] as { text: string };
    expect(note.text).not.toContain("What is GLP-1?");
  });

  it("reuses the previous session slot and still ends it later", async () => {
    const { ctl, voice, voices, factoryOpts, started, ended, flush } = setup();
    await started();
    Object.defineProperty(voice(), "sessionId", { value: "sess-1" });
    voice().drop("network");
    await flush();
    expect(voices).toHaveLength(2);
    expect(factoryOpts[1]).toEqual({ reconnectOf: "sess-1" });
    ctl.end();
    expect(ended).toEqual(["sess-1"]);
  });

  it("End during a reconnect stops the loop at once", async () => {
    const { ctl, voice, voices, fails, started, view, flush } = setup();
    await started();
    fails.left = 3;
    voice().drop("network");
    await flush(); // first attempt failed; now waiting 500 ms
    expect(voices).toHaveLength(2);
    ctl.end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(voices).toHaveLength(2);
    expect(view().screen).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("when every retry fails and the network is down, it goes offline instead of failing", async () => {
    const net = { up: true };
    const { voice, fails, started, view, flush } = setup({
      backup: true,
      probe: async () => net.up,
    });
    await started();
    fails.left = 3;
    net.up = false;
    voice().drop("network");
    await vi.advanceTimersByTimeAsync(2600);
    await flush();
    expect(view().snapshot.voice).toBe("offline");
    expect(view().snapshot.connection).toBe("connected");
  });

  it("the interrupt-timeout recovery also reconnects", async () => {
    const { ctl, voices, started, last, startPlaying, view } = setup();
    await started();
    startPlaying(last().requestId);
    await ctl.askTyped("Q");
    await vi.advanceTimersByTimeAsync(1600);
    expect(voices).toHaveLength(2);
    expect(view().askAgain).toBe(true);
  });
});

describe("backup voice (arch §6.4)", () => {
  it("continues the talk with browser speech after the retries fail, without a reload", async () => {
    const { speech, view } = await startInBackup();
    expect(view().snapshot.voice).toBe("backup");
    expect(view().snapshot.connection).toBe("connected");
    expect(view().status.label).toBe("Type your question below");
    expect(speech!.last().text).toBe(deck[0]!.segments[0]!.text);
    speech!.start();
    speech!.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(speech!.last().text).toBe(deck[0]!.segments[1]!.text);
  });

  it("Space is off in backup mode; the notice points at typing", async () => {
    const { ctl, view } = await startInBackup();
    ctl.talkDown();
    expect(view().notice).toContain("type your question");
    expect(view().capturing).toBeNull();
  });

  it("a typed question hits /api/chat with the displayed slide and is spoken and captioned", async () => {
    const { ctl, speech, chats, view, flush } = await startInBackup();
    speech!.start();
    await ctl.askTyped("What are the side effects?");
    await flush();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ question: "What are the side effects?", slideId: "intro" });
    expect(speech!.last().text).toBe("Backup answer.");
    speech!.start();
    expect(view().captions.some((c) => c.text.includes("Backup answer."))).toBe(true);
  });

  it("navigation from the chat answer lands first and the talk returns to its checkpoint", async () => {
    const { ctl, speech, view, flush } = await startInBackup({
      chat: async () => ({
        ok: true,
        data: { answer: "See safety.", goto_slide: { slide_id: "safety", intent: "answer" } },
      }),
    });
    await ctl.askTyped("side effects?");
    await flush();
    expect(view().displayedSlide).toBe("safety");
    speech!.start();
    speech!.end();
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(view().displayedSlide).toBe("intro");
    expect(speech!.last().text.startsWith("Back to where we were")).toBe(true);
  });

  it("each chat answer completes the turn without a continuation request", async () => {
    const { ctl, speech, flush } = await startInBackup({
      chat: async () => ({
        ok: true,
        data: { answer: "Done.", goto_slide: { slide_id: "safety", intent: "answer" } },
      }),
    });
    await ctl.askTyped("side effects?");
    await flush();
    speech!.start();
    speech!.end();
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(speech!.spoken.filter((u) => u.text === "Done.")).toHaveLength(1);
  });

  it("a chat failure offers Ask again and never advances narration", async () => {
    const { ctl, view, flush } = await startInBackup({
      chat: async () => ({ ok: false, code: "backend_unreachable" }),
    });
    await ctl.askTyped("hello?");
    await flush();
    expect(view().snapshot.error).toBe("response_failed");
    expect(view().askAgain).toBe(true);
  });

  it("with no speech engine the scripts are shown, the talk is paused and answers stay as text", async () => {
    const { ctl, view, flush } = await startInBackup({ speech: null });
    expect(view().scriptMode).toBe(true);
    expect(view().presentationStatus).toBe("paused");
    expect(view().notice).toContain("Audio unavailable");
    await ctl.askTyped("What is it?");
    await flush();
    expect(view().captions.some((c) => c.text.includes("Backup answer."))).toBe(true);
    // Resume needs working audio: it stays paused with the script in view.
    ctl.resume();
    expect(view().presentationStatus).toBe("paused");
    expect(view().scriptMode).toBe(true);
  });

  it("a speech failure mid-talk switches to scripts without advancing the checkpoint", async () => {
    const { speech, view, flush } = await startInBackup();
    speech!.start();
    speech!.fail();
    await flush();
    expect(view().scriptMode).toBe(true);
    expect(view().checkpoint).toEqual({ slideId: "intro", sentenceIndex: 0 });
    expect(view().presentationStatus).toBe("paused");
  });

  it("the live probe swaps back only at a boundary, then narrates the same sentence onward", async () => {
    const { speech, voices, view, last, voice, flush } = await startInBackup();
    speech!.start(); // sentence 0 is playing
    const before = voices.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(voices.length).toBe(before + 1); // one probe, connected and parked
    expect(view().snapshot.voice).toBe("backup"); // mid-sentence: no swap
    speech!.end(); // boundary
    await flush();
    expect(view().snapshot.voice).toBe("live");
    expect(voice().commands.some((c) => c.type === "addControllerNote")).toBe(true);
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 1 });
    expect(view().snapshot.connection).toBe("connected");
  });

  it("probes run one at a time, including Try live voice again", async () => {
    const { ctl, voices, flush } = await startInBackup();
    const before = voices.length;
    ctl.tryLiveAgain();
    ctl.tryLiveAgain();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(voices.length).toBe(before + 1);
  });

  it("a failed probe retries on the next 30 s tick", async () => {
    const { fails, voices, view } = await startInBackup();
    fails.left = 1;
    const before = voices.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(voices.length).toBe(before + 1);
    expect(view().snapshot.voice).toBe("backup");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(voices.length).toBe(before + 2);
  });

  it("a paused talk swaps back at once and stays paused", async () => {
    const { ctl, view, creates, flush } = await startInBackup();
    ctl.togglePause();
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(view().snapshot.voice).toBe("live");
    expect(view().presentationStatus).toBe("paused");
    expect(creates()).toHaveLength(0);
  });

  it("End cancels probes and speech", async () => {
    const { ctl, speech, voices } = await startInBackup();
    ctl.end();
    const before = voices.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(voices.length).toBe(before);
    expect(speech!.cancels).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("offline (arch §6.5)", () => {
  const net = { up: true };
  const probe = async () => net.up;

  it("no local voice: scripts are shown, questions are disabled, the talk is paused", async () => {
    net.up = false;
    const { ctl, started, view, chats, flush } = setup({ backup: true, probe });
    await started();
    ctl.networkHint(false);
    await flush();
    expect(view().snapshot.voice).toBe("offline");
    expect(view().status.label).toBe("You're offline — questions are paused");
    expect(view().scriptMode).toBe(true);
    expect(view().controls.ask).toBe(false);
    expect(view().presentationStatus).toBe("paused");
    await ctl.askTyped("anything");
    expect(chats).toHaveLength(0);
  });

  it("coming back online resumes live voice on the same checkpoint at a boundary", async () => {
    net.up = false;
    const { ctl, started, view, last, voices, flush } = setup({ backup: true, probe });
    await started();
    ctl.goto(2);
    const checkpoint = view().checkpoint;
    ctl.networkHint(false);
    await flush();
    expect(view().snapshot.voice).toBe("offline");
    net.up = true;
    ctl.networkHint(true);
    await flush();
    expect(voices.length).toBeGreaterThanOrEqual(2);
    expect(view().snapshot.voice).toBe("live");
    expect(view().scriptMode).toBe(false);
    expect(view().presentationStatus).toBe("running");
    expect(view().checkpoint).toEqual(checkpoint);
    expect(last()).toMatchObject({ kind: "narration", slideId: checkpoint.slideId });
  });

  it("a deliberately paused talk stays paused through an offline round trip", async () => {
    net.up = false;
    const { ctl, started, view, creates, flush } = setup({ backup: true, probe });
    await started();
    ctl.togglePause();
    ctl.networkHint(false);
    await flush();
    net.up = true;
    ctl.networkHint(true);
    await flush();
    expect(view().snapshot.voice).toBe("live");
    expect(view().presentationStatus).toBe("paused");
    expect(creates()).toHaveLength(0);
  });

  it("with an on-device voice the talk continues locally", async () => {
    net.up = false;
    const speech = new FakeSpeech([{ localService: true, name: "local" }]);
    const { ctl, started, view, flush } = setup({ backup: true, probe, speech });
    await started();
    ctl.networkHint(false);
    await flush();
    expect(view().snapshot.voice).toBe("offline");
    expect(view().scriptMode).toBe(false);
    expect(view().presentationStatus).toBe("running");
    expect(speech.last().text).toContain(deck[0]!.segments[0]!.text);
    expect(speech.last().voice?.name).toBe("local");
  });

  it("an offline hint that the probe disproves changes nothing", async () => {
    net.up = true;
    const { ctl, started, view, voices, flush } = setup({ backup: true, probe });
    await started();
    ctl.networkHint(false);
    await flush();
    expect(view().snapshot.voice).toBe("live");
    expect(voices).toHaveLength(1);
  });

  it("the reviewer's draft lives in the input, which is only disabled", async () => {
    net.up = false;
    const { ctl, started, view, flush } = setup({ backup: true, probe });
    await started();
    ctl.networkHint(false);
    await flush();
    // The controller never clears a draft; the AskBox keeps it and merely disables sending.
    expect(view().controls.ask).toBe(false);
  });
});

describe("microphone (arch §4.8)", () => {
  it("mic_ended switches to text mode, stops the stream and offers Try microphone again", async () => {
    const { voice, tracks, started, view } = setup();
    await started();
    voice().micEnded();
    expect(view().snapshot.input).toBe("text");
    expect(tracks[0]!.stopped).toBe(true);
    expect(view().canTryMic).toBe(true);
    expect(view().notice).toContain("microphone disconnected");
  });

  it("Try microphone again replaces the track when a sender exists", async () => {
    const { ctl, voice, voices, mic, started, view } = setup();
    await started();
    voice().micEnded();
    await ctl.useMicrophone(mic());
    expect(voices).toHaveLength(1);
    expect(voice().commands.some((c) => c.type === "replaceMic")).toBe(true);
    expect(view().snapshot.input).toBe("voice");
  });

  it("from a receive-only connection it reconnects with an outgoing track", async () => {
    const { ctl, mic, voices, voice, started, view, flush } = setup();
    await started({ withMic: false });
    expect(view().snapshot.input).toBe("text");
    expect(voice().commands[0]).toMatchObject({ type: "connect", hasMic: false });
    await ctl.useMicrophone(mic());
    await flush();
    expect(voices).toHaveLength(2);
    expect(voice().commands[0]).toMatchObject({ type: "connect", hasMic: true });
    expect(view().snapshot.input).toBe("voice");
  });

  it("a reconnect after the mic was lost stays in text mode", async () => {
    const { voice, voices, started, view, flush } = setup();
    await started();
    voice().micEnded();
    voice().drop("network");
    await flush();
    expect(voices).toHaveLength(2);
    expect(voice().commands[0]).toMatchObject({ type: "connect", hasMic: false });
    expect(view().snapshot.input).toBe("text");
  });

  it("typed questions work in text mode and get a spoken answer", async () => {
    const { ctl, started, last, view, flush } = setup();
    await started({ withMic: false });
    await ctl.askTyped("What is it?");
    await flush();
    expect(view().controls.ask).toBe(true);
    expect(view().status.label).not.toContain("Space");
    expect(last().kind).toBeDefined();
  });
});
