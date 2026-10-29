import { afterEach, describe, expect, it, vi } from "vitest";
import { deck } from "@ava/shared";
import { narrationOverrun } from "../../src/presentation/captions.js";
import { TIMING } from "../../src/presentation/controller.js";
import { setup } from "./harness.js";

afterEach(() => vi.useRealTimers());

describe("narration", () => {
  it("greets first, then narrates slide 1 sentence 0 out of band without tools", async () => {
    const { ctl, mic, last, play, view } = setup();
    await ctl.start(mic());
    expect(last()).toMatchObject({ kind: "greeting", toolChoice: "none", outOfBand: true });
    expect(view().status.label).toBe("Hold Space or tap to talk");
    play(last().requestId);
    expect(last()).toMatchObject({
      kind: "narration",
      slideId: "intro",
      sentenceIndex: 0,
      toolChoice: "none",
      outOfBand: true,
      turnId: null,
    });
  });

  it("advances narration after playback, not after response.done", async () => {
    const { voice, started, creates, last } = setup();
    await started();
    const s0 = last();
    const before = creates().length;
    voice().generationStarted(s0.requestId);
    voice().playbackStarted(s0.requestId);
    voice().generationDone(s0.requestId, "completed", { hadAudio: true });
    expect(creates().length).toBe(before); // generation ended but audio still playing: no new request
    voice().playbackCompleted(s0.requestId);
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 1 });
  });

  it("shows Speaking while audio plays and highlights the sentence's bullet", async () => {
    const { started, last, startPlaying, view } = setup();
    await started();
    startPlaying(last().requestId);
    expect(view().status.label).toBe("Speaking — hold Space to interrupt");
    expect(view().orb).toBe("speaking");
    expect(view().highlightBullet).toBe(deck[0]!.segments[0]!.bullet);
  });

  it("changes slides only when the next slide's first sentence begins, and finishes after the recap", async () => {
    const { started, last, play, view, creates } = setup();
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) {
      const r = last();
      expect(r.kind).toBe("narration");
      expect(view().displayedSlide).toBe(r.slideId);
      play(r.requestId);
    }
    const n = creates().length;
    expect(view().presentationStatus).toBe("finished");
    expect(view().checkpoint).toEqual({ slideId: "future", sentenceIndex: 0 });
    expect(view().status.label).toBe("Any final questions? Hold Space");
    vi.advanceTimersByTime(10_000);
    expect(creates().length).toBe(n); // nothing is narrated automatically
  });

  it("a failed narration generation shows Retry and Retry requests the sentence again", async () => {
    const { ctl, voice, started, last, view } = setup();
    await started();
    const s0 = last();
    voice().generationStarted(s0.requestId);
    voice().generationDone(s0.requestId, "failed", { hadAudio: false });
    expect(view().snapshot.error).toBe("response_failed");
    expect(view().controls.retry).toBe(true);
    ctl.retry();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
    expect(last().requestId).not.toBe(s0.requestId);
  });
});

describe("tap-to-talk turns", () => {
  it("pressing Space mutes, cancels and listens at once", async () => {
    const { ctl, voice, started, last, startPlaying, view } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.talkDown();
    expect(voice().gain).toBe(0);
    expect(voice().commands.map((c) => c.type)).toContain("beginUserTurn");
    expect(view().status.label).toBe("Listening…");
    expect(view().orb).toBe("listening");
  });

  it("a short Space press restarts the checkpoint sentence", async () => {
    const { ctl, voice, started, last, play, startPlaying, flush } = setup();
    await started();
    play(last().requestId); // sentence 0
    const s1 = last();
    startPlaying(s1.requestId);
    ctl.talkDown();
    vi.advanceTimersByTime(120);
    ctl.talkUp();
    voice().ackInterrupt();
    await flush();
    expect(voice().commands).toContainEqual(
      expect.objectContaining({ type: "endUserTurn", cancel: true }),
    );
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 1 });
    expect(last().requestId).not.toBe(s1.requestId);
  });

  it("a long press commits, answers in band with tools, then resumes the interrupted sentence after 1.5 s", async () => {
    const { ctl, voice, started, last, play, startPlaying, spoken, view, creates } = setup();
    await started();
    play(last().requestId); // sentence 0
    startPlaying(last().requestId); // sentence 1 interrupted
    const answer = await spoken();
    expect(answer).toMatchObject({ kind: "answer", toolChoice: "auto", outOfBand: false });
    expect(answer.turnId).not.toBeNull();
    expect(view().status.label).toBe("Thinking…");
    play(answer.requestId, "Because it slows the stomach.");
    expect(view().snapshot.presentation).toBe("awaitingResume");
    const n = creates().length;
    vi.advanceTimersByTime(TIMING.resumeWindowMs - 1);
    expect(creates().length).toBe(n);
    vi.advanceTimersByTime(1);
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 1 });
    expect(last().instructions).toContain("very short bridge back");
    void ctl;
    void voice;
  });

  it("the output gate stays muted until the replacement response is authorized", async () => {
    const { ctl, voice, started, last, startPlaying, flush } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.talkDown();
    vi.advanceTimersByTime(500);
    ctl.talkUp();
    await flush();
    voice().userCommitted("item_u");
    await flush();
    expect(voice().gain).toBe(0); // old playback not yet cleared: no answer requested, still muted
    expect(last().kind).toBe("narration");
    voice().ackInterrupt();
    await flush();
    expect(last().kind).toBe("answer");
    expect(voice().gain).toBe(1);
  });

  it("an empty committed turn restores the saved status", async () => {
    const { ctl, voice, started, last, startPlaying, flush } = setup();
    await started();
    const s0 = last();
    startPlaying(s0.requestId);
    ctl.talkDown();
    voice().ackInterrupt();
    vi.advanceTimersByTime(500);
    ctl.talkUp();
    await flush();
    voice().userEmpty();
    await flush();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
    expect(last().requestId).not.toBe(s0.requestId);
  });

  it("focus loss while holding cancels without submitting and leaves the talk paused", async () => {
    const { ctl, voice, started, last, startPlaying, flush, view, creates } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.talkDown();
    voice().ackInterrupt();
    ctl.focusLost();
    await flush();
    const n = creates().length;
    expect(voice().commands).toContainEqual(
      expect.objectContaining({ type: "endUserTurn", cancel: true }),
    );
    expect(view().presentationStatus).toBe("paused");
    expect(view().status.label).toBe("Paused — press Resume or P");
    vi.advanceTimersByTime(5000);
    expect(creates().length).toBe(n);
  });

  it("Esc while holding cancels and restores the prior status", async () => {
    const { ctl, voice, started, last, startPlaying, flush } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.talkDown();
    voice().ackInterrupt();
    ctl.escape();
    await flush();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
  });

  it("orb: the first tap starts, the second sends; no accidental rule", async () => {
    const { ctl, voice, started, flush, view, last } = setup();
    await started();
    ctl.orbPress();
    expect(view().capturing).toBe("orb");
    voice().ackInterrupt();
    vi.advanceTimersByTime(50);
    ctl.orbPress();
    await flush();
    voice().userCommitted("item_orb");
    await flush();
    expect(last().kind).toBe("answer");
  });

  it("orb: capture auto-sends after 30 s", async () => {
    const { ctl, voice, started, flush, view } = setup();
    await started();
    ctl.orbPress();
    vi.advanceTimersByTime(TIMING.orbTurnMs);
    await flush();
    expect(voice().commands).toContainEqual(
      expect.objectContaining({ type: "endUserTurn", cancel: false }),
    );
    expect(view().capturing).toBeNull();
  });

  it("talk is ignored with a hint in text mode", async () => {
    const { ctl, voice, view } = setup();
    await ctl.start(null);
    // start() with no mic is text mode
    ctl.talkDown();
    expect(voice().commands.map((c) => c.type)).not.toContain("beginUserTurn");
    expect(view().notice).toMatch(/type your question/);
    expect(view().status.label).not.toMatch(/Space/);
  });
});

describe("tools", () => {
  it("replies to each tool call once and requests one continuation", async () => {
    const { voice, started, typed, last, view, kinds } = setup();
    await started();
    const answer = await typed("What are the side effects?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "call_1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().toolCall(answer.requestId, "call_1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    }); // duplicate
    expect(view().displayedSlide).toBe("safety"); // the slide moves before the continuation
    expect(view().checkpoint.slideId).toBe("intro");
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    expect(voice().toolResults("call_1")).toHaveLength(1);
    expect(voice().toolResults("call_1")[0]!.output).toEqual({
      ok: true,
      slide_title: "Side effects and safety",
    });
    expect(last().kind).toBe("continuation");
    expect(kinds().filter((k) => k === "continuation")).toHaveLength(1);
  });

  it("a cross-slide answer returns to the checkpoint slide with a return bridge (brief §12 check 4)", async () => {
    const { ctl, voice, started, typed, last, play, view } = setup();
    await started();
    ctl.goto(1); // slide 2
    voice().ackInterrupt();
    await vi.advanceTimersByTimeAsync(0);
    const s = last();
    expect(s).toMatchObject({ slideId: "mechanism", sentenceIndex: 0 });
    const answer = await typed("What are the side effects?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    const cont = last();
    play(cont.requestId, "Nausea is the most common.");
    expect(view().displayedSlide).toBe("safety");
    expect(view().showStayHere).toBe(true);
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(view().displayedSlide).toBe("mechanism");
    expect(last()).toMatchObject({ kind: "narration", slideId: "mechanism", sentenceIndex: 0 });
    expect(last().instructions).toContain('going back to "How the medicines work"');
  });

  it("a tool-only response never starts auto-resume", async () => {
    const { voice, started, typed, last, creates } = setup();
    await started();
    const answer = await typed("Show me the evidence slide");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "evidence",
      intent: "user_request",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    vi.advanceTimersByTime(TIMING.resumeWindowMs * 2);
    expect(last().kind).toBe("continuation");
    expect(creates().filter((c) => c.kind === "narration")).toHaveLength(1); // only sentence 0 from before
  });

  it("goto_slide user_request replaces the checkpoint; after the answer the new slide starts without a return bridge", async () => {
    const { voice, started, typed, last, play, view } = setup();
    await started();
    const answer = await typed("Go to the evidence slide");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "evidence",
      intent: "user_request",
    });
    expect(view().displayedSlide).toBe("evidence");
    expect(view().checkpoint).toEqual({ slideId: "evidence", sentenceIndex: 0 });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    play(last().requestId, "Here is the evidence.");
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(last()).toMatchObject({ kind: "narration", slideId: "evidence", sentenceIndex: 0 });
    expect(last().instructions).not.toContain("going back");
  });

  it("goto_slide for the displayed slide replies already_showing", async () => {
    const { voice, started, typed } = setup();
    await started();
    const answer = await typed("What is GLP-1?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", { slide_id: "intro", intent: "answer" });
    expect(voice().toolResults("c1")[0]!.output).toEqual({ ok: true, already_showing: true });
  });

  it("goto_slide stay replaces the checkpoint with the displayed slide", async () => {
    const { voice, started, typed, last, view } = setup();
    await started();
    const answer = await typed("Side effects?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    const cont = last();
    voice().generationStarted(cont.requestId);
    voice().toolCall(cont.requestId, "c2", "goto_slide", { slide_id: "safety", intent: "stay" });
    expect(view().checkpoint).toEqual({ slideId: "safety", sentenceIndex: 0 });
  });

  it("an invalid tool twice shows Retry instead of looping", async () => {
    const { voice, started, typed, last, view, kinds } = setup();
    await started();
    const answer = await typed("Show me slide nine");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", { slide_id: "nope", intent: "answer" });
    expect(voice().toolResults("c1")[0]!.output).toMatchObject({
      ok: false,
      error: "unknown slide_id",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    const cont = last();
    expect(cont.kind).toBe("continuation");
    voice().generationStarted(cont.requestId);
    voice().toolCall(cont.requestId, "c2", "goto_slide", { slide_id: "nine" });
    voice().generationDone(cont.requestId, "completed", { hadAudio: false });
    expect(view().snapshot.error).toBe("response_failed");
    expect(view().controls.retry).toBe(true);
    expect(kinds().filter((k) => k === "continuation")).toHaveLength(1);
  });

  it("continuations are bounded to two", async () => {
    const { voice, started, typed, last, view, kinds } = setup();
    await started();
    let r = await typed("Hop around");
    const slides = ["safety", "evidence", "uses"] as const;
    for (const [i, slide] of slides.entries()) {
      voice().generationStarted(r.requestId);
      voice().toolCall(r.requestId, `c${i}`, "goto_slide", { slide_id: slide, intent: "answer" });
      voice().generationDone(r.requestId, "completed", { hadAudio: false });
      r = last();
    }
    expect(kinds().filter((k) => k === "continuation")).toHaveLength(2);
    expect(view().snapshot.error).toBe("response_failed");
  });

  it("calls from a cancelled response get a cancelled reply and no continuation", async () => {
    const { ctl, voice, started, typed, kinds } = setup();
    await started();
    const answer = await typed("What are the side effects?");
    voice().generationStarted(answer.requestId);
    ctl.togglePause(); // interrupts the answer
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().ackInterrupt();
    expect(voice().toolResults("c1")[0]!.output).toEqual({ ok: false, cancelled: true });
    expect(kinds()).not.toContain("continuation");
  });

  it("resume_presentation schedules narration after the barrier with no continuation", async () => {
    const { voice, started, typed, last, kinds } = setup();
    await started();
    const answer = await typed("go on");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "resume_presentation", {});
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    expect(voice().toolResults("c1")[0]!.output).toEqual({ ok: true });
    expect(kinds()).not.toContain("continuation");
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 0 });
  });

  it("resume_presentation wins over an answer jump in the same response", async () => {
    const { voice, started, typed, last, kinds } = setup();
    await started();
    const answer = await typed("ok go on");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().toolCall(answer.requestId, "c2", "resume_presentation", {});
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    expect(voice().toolResults("c1")).toHaveLength(1);
    expect(voice().toolResults("c2")).toHaveLength(1);
    expect(kinds()).not.toContain("continuation");
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro" });
  });

  it("an unknown tool name gets an error reply", async () => {
    const { voice, started, typed } = setup();
    await started();
    const answer = await typed("hi");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "cite_facts", {});
    expect(voice().toolResults("c1")[0]!.output).toEqual({ ok: false, error: "unknown tool" });
  });
});

describe("questions, status restore and follow-ups (arch §4.7)", () => {
  it("a question asked while paused answers, restores the checkpoint slide and stays paused", async () => {
    const { ctl, voice, started, last, play, typed, view, creates } = setup();
    await started();
    ctl.togglePause();
    expect(view().presentationStatus).toBe("paused");
    const answer = await typed("What are the side effects?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    play(last().requestId, "Mostly nausea.");
    const n = creates().length;
    vi.advanceTimersByTime(5000);
    expect(creates().length).toBe(n);
    expect(view().presentationStatus).toBe("paused");
    expect(view().displayedSlide).toBe("intro");
    expect(view().status.label).toBe("Paused — press Resume or P");
  });

  it("a question after finished never restarts narration and returns to the pre-question slide", async () => {
    const { ctl, voice, started, last, play, typed, view, creates } = setup();
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) play(last().requestId);
    expect(view().presentationStatus).toBe("finished");
    ctl.goto(3); // explicit navigation while finished: evidence, still finished
    expect(view().displayedSlide).toBe("evidence");
    expect(view().presentationStatus).toBe("finished");
    const answer = await typed("What are the side effects?");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "goto_slide", {
      slide_id: "safety",
      intent: "answer",
    });
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    play(last().requestId);
    const n = creates().length;
    vi.advanceTimersByTime(5000);
    expect(creates().length).toBe(n);
    expect(view().displayedSlide).toBe("evidence");
    expect(view().presentationStatus).toBe("finished");
    expect(creates().filter((c) => c.kind === "narration").length).toBe(total);
  });

  it("resume_presentation is a no-op once finished", async () => {
    const { voice, started, last, play, typed, view, creates } = setup();
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) play(last().requestId);
    const answer = await typed("go on");
    voice().generationStarted(answer.requestId);
    voice().toolCall(answer.requestId, "c1", "resume_presentation", {});
    voice().generationDone(answer.requestId, "completed", { hadAudio: false });
    expect(voice().toolResults("c1")[0]!.output).toEqual({ ok: true, no_op: true });
    vi.advanceTimersByTime(5000);
    expect(view().presentationStatus).toBe("finished");
    expect(creates().filter((c) => c.kind === "narration").length).toBe(total);
  });

  it("Resume after finished narrates the selected checkpoint", async () => {
    const { ctl, started, last, play, view } = setup();
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) play(last().requestId);
    ctl.goto(2);
    ctl.togglePause(); // P = Resume when not running
    expect(view().presentationStatus).toBe("running");
    expect(last()).toMatchObject({ kind: "narration", slideId: "uses", sentenceIndex: 0 });
  });

  it("a follow-up during an answer keeps the first snapshot", async () => {
    const { ctl, voice, started, last, play, typed, view } = setup();
    await started();
    ctl.goto(1);
    const a1 = await typed("Side effects?");
    voice().generationStarted(a1.requestId);
    voice().toolCall(a1.requestId, "c1", "goto_slide", { slide_id: "safety", intent: "answer" });
    voice().generationDone(a1.requestId, "completed", { hadAudio: false });
    const c1 = last();
    voice().generationStarted(c1.requestId);
    voice().playbackStarted(c1.requestId);
    // Follow-up while the first answer plays.
    const a2 = await typed("And after stopping?");
    expect(a2.kind).toBe("answer");
    play(a2.requestId, "Weight often returns.");
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(last()).toMatchObject({ kind: "narration", slideId: "mechanism", sentenceIndex: 0 });
    expect(view().displayedSlide).toBe("mechanism");
  });

  it("a typed question between goto_slide and its continuation leaves exactly one new response", async () => {
    const { voice, started, typed, creates, last } = setup();
    await started();
    const a1 = await typed("What are the side effects?");
    voice().generationStarted(a1.requestId);
    voice().toolCall(a1.requestId, "c1", "goto_slide", { slide_id: "safety", intent: "answer" });
    const before = creates().length;
    const a2 = await typed("Actually, how much weight do people lose?");
    // The first answer is still generating: nothing new until its cancellation settles.
    voice().generationDone(a1.requestId, "completed", { hadAudio: false });
    await vi.advanceTimersByTimeAsync(0);
    const after = creates().slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]!.kind).toBe("answer");
    expect(last().requestId).toBe(a2.requestId);
    expect(voice().toolResults("c1")).toHaveLength(1);
  });

  it("a cut answer offers Ask again, which re-requests the answer for the same item", async () => {
    const { ctl, voice, started, typed, last, view, flush } = setup();
    await started();
    const a1 = await typed("Tell me about SELECT");
    voice().generationStarted(a1.requestId);
    voice().playbackStarted(a1.requestId);
    // An accidental press during the answer cuts it.
    ctl.talkDown();
    voice().ackInterrupt();
    vi.advanceTimersByTime(100);
    ctl.talkUp();
    await flush();
    expect(view().askAgain).toBe(true);
    expect(last().requestId).toBe(a1.requestId); // not silently replaced by narration
    ctl.askAgain();
    await flush();
    expect(last()).toMatchObject({ kind: "answer" });
    expect(last().requestId).not.toBe(a1.requestId);
    expect(view().askAgain).toBe(false);
  });

  it("dismissing Ask again restores the saved status", async () => {
    const { ctl, voice, started, typed, last, flush } = setup();
    await started();
    const a1 = await typed("Tell me about SELECT");
    voice().generationStarted(a1.requestId);
    ctl.togglePause();
    voice().ackInterrupt();
    await flush();
    ctl.escape(); // dismisses Ask again
    ctl.togglePause(); // resume
    await flush();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
  });

  it("a failed answer offers Retry, which asks again", async () => {
    const { ctl, voice, started, typed, last, view, flush } = setup();
    await started();
    const a1 = await typed("Q");
    voice().generationStarted(a1.requestId);
    voice().generationDone(a1.requestId, "failed", { hadAudio: false });
    expect(view().snapshot.error).toBe("response_failed");
    ctl.retry();
    await flush();
    expect(last().kind).toBe("answer");
    expect(last().requestId).not.toBe(a1.requestId);
    expect(view().snapshot.error).toBeNull();
  });
});

describe("explicit navigation and stay here", () => {
  it("arrows replace the checkpoint and keep running; paused stays paused", async () => {
    const { ctl, voice, started, last, startPlaying, view, flush, creates } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.next();
    expect(view().displayedSlide).toBe("mechanism");
    expect(view().checkpoint).toEqual({ slideId: "mechanism", sentenceIndex: 0 });
    voice().ackInterrupt();
    await flush();
    expect(last()).toMatchObject({ kind: "narration", slideId: "mechanism", sentenceIndex: 0 });
    ctl.togglePause();
    voice().ackInterrupt();
    const n = creates().length;
    ctl.next();
    await flush();
    expect(view().displayedSlide).toBe("uses");
    expect(view().presentationStatus).toBe("paused");
    expect(creates().length).toBe(n);
  });

  it("no out-of-range navigation", async () => {
    const { ctl, started, view } = setup();
    await started();
    ctl.prev();
    expect(view().displayedSlide).toBe("intro");
    ctl.goto(5);
    ctl.next();
    expect(view().displayedSlide).toBe("future");
    ctl.goto(9);
    expect(view().displayedSlide).toBe("future");
  });

  it("Stay here replaces the checkpoint with the displayed slide's first sentence", async () => {
    const { ctl, voice, started, typed, last, play, view } = setup();
    await started();
    const a = await typed("Side effects?");
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c1", "goto_slide", { slide_id: "safety", intent: "answer" });
    voice().generationDone(a.requestId, "completed", { hadAudio: false });
    play(last().requestId);
    expect(view().showStayHere).toBe(true);
    ctl.stayHere();
    expect(view().showStayHere).toBe(false);
    expect(view().checkpoint).toEqual({ slideId: "safety", sentenceIndex: 0 });
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(last()).toMatchObject({ kind: "narration", slideId: "safety", sentenceIndex: 0 });
  });

  it("navigation cancels the resume window", async () => {
    const { ctl, voice, started, typed, play, last, flush } = setup();
    await started();
    const a = await typed("Q");
    play(a.requestId);
    ctl.goto(4);
    voice().ackInterrupt();
    await flush();
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(last()).toMatchObject({ kind: "narration", slideId: "safety", sentenceIndex: 0 });
  });
});

describe("pause and typing", () => {
  it("Pause interrupts at once and Resume restarts the sentence", async () => {
    const { ctl, voice, started, last, play, startPlaying, view, flush } = setup();
    await started();
    play(last().requestId);
    const s1 = last();
    startPlaying(s1.requestId);
    ctl.togglePause();
    expect(voice().gain).toBe(0);
    expect(view().status.label).toBe("Paused — press Resume or P");
    voice().ackInterrupt();
    await flush();
    expect(last().requestId).toBe(s1.requestId);
    ctl.togglePause();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 1 });
    expect(last().requestId).not.toBe(s1.requestId);
  });

  it("typing pauses at once; clearing the box resumes a running talk's sentence", async () => {
    const { ctl, voice, started, last, startPlaying, view, flush } = setup();
    await started();
    const s0 = last();
    startPlaying(s0.requestId);
    ctl.typingStarted();
    expect(voice().gain).toBe(0);
    expect(view().status.label).toBe("Paused while you type");
    voice().ackInterrupt();
    await flush();
    expect(last().requestId).toBe(s0.requestId);
    ctl.typingCleared();
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
    expect(last().requestId).not.toBe(s0.requestId);
  });

  it("clearing the box keeps a deliberately paused talk paused", async () => {
    const { ctl, started, view, creates } = setup();
    await started();
    ctl.togglePause();
    ctl.typingStarted();
    ctl.typingCleared();
    const n = creates().length;
    vi.advanceTimersByTime(5000);
    expect(creates().length).toBe(n);
    expect(view().presentationStatus).toBe("paused");
  });

  it("typing cancels the resume window", async () => {
    const { ctl, started, typed, play, creates } = setup();
    await started();
    const a = await typed("Q");
    play(a.requestId);
    const n = creates().length;
    ctl.typingStarted();
    vi.advanceTimersByTime(TIMING.resumeWindowMs * 2);
    expect(creates().length).toBe(n);
  });

  it("typed send: typing → send → answer → resume (brief §12 check 10)", async () => {
    const { ctl, voice, started, last, startPlaying, play, flush } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.typingStarted();
    await ctl.askTyped("How long does it last?");
    voice().ackInterrupt();
    await flush();
    const a = last();
    expect(a.kind).toBe("answer");
    expect(voice().commands).toContainEqual(
      expect.objectContaining({ type: "sendUserText", text: "How long does it last?" }),
    );
    play(a.requestId);
    vi.advanceTimersByTime(TIMING.resumeWindowMs);
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
  });
});

describe("timers (arch §4.6)", () => {
  it("thinking warning at 4 s and timeout at 10 s span tool continuations", async () => {
    const { voice, started, typed, last, view } = setup();
    await started();
    const a = await typed("What are the side effects?");
    expect(view().status.label).toBe("Thinking…");
    vi.advanceTimersByTime(3000);
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c1", "goto_slide", { slide_id: "safety", intent: "answer" });
    voice().generationDone(a.requestId, "completed", { hadAudio: false });
    const cont = last();
    expect(cont.kind).toBe("continuation");
    vi.advanceTimersByTime(1000);
    expect(view().status.label).toBe("Still working…");
    vi.advanceTimersByTime(5999);
    expect(view().snapshot.error).toBeNull();
    vi.advanceTimersByTime(1);
    expect(view().snapshot.error).toBe("response_timeout");
    expect(view().status.label).toBe("That took too long.");
    expect(view().askAgain).toBe(true);
  });

  it("the first audible answer stops the thinking timers", async () => {
    const { voice, started, typed, view } = setup();
    await started();
    const a = await typed("Q");
    voice().generationStarted(a.requestId);
    voice().playbackStarted(a.requestId);
    vi.advanceTimersByTime(20_000);
    expect(view().snapshot.error).toBeNull();
    expect(view().status.label).toBe("Speaking — hold Space to interrupt");
  });

  it("an interrupt that is never acknowledged reconnects under a new epoch", async () => {
    const { ctl, voices, started, last, startPlaying } = setup();
    await started();
    startPlaying(last().requestId);
    await ctl.askTyped("Q");
    await vi.advanceTimersByTimeAsync(1500);
    expect(voices).toHaveLength(2);
    expect(voices[0]!.closed).toBe(true);
    expect(voices[1]!.epoch).toBeGreaterThan(voices[0]!.epoch);
  });
});

describe("epochs, disconnects and End", () => {
  it("ignores events from an old epoch", async () => {
    const { voice, ctl, started } = setup();
    await started();
    const before = ctl.view();
    voice().emitStale({ type: "playback_completed", responseId: "old" });
    voice().emitStale({
      type: "generation_done",
      requestId: "x",
      responseId: "old",
      status: "completed",
      hadAudio: false,
    });
    expect(ctl.view()).toEqual(before);
  });

  it("a dropped connection reconnects by itself and narrates the checkpoint with a reconnect bridge", async () => {
    const { voice, voices, started, last, play, view, flush } = setup();
    await started();
    play(last().requestId); // intro 0 played
    voice().drop("network");
    expect(view().status.label).toBe("Connection lost — reconnecting…");
    await flush();
    expect(view().snapshot.error).toBeNull();
    expect(voices).toHaveLength(2);
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 1 });
    expect(last().instructions).toContain("We're back.");
  });

  it("End stops the mic, closes the adapter, clears every timer and sends the end beacon", async () => {
    const { ctl, voice, flush, view } = setup();
    const stopped: boolean[] = [];
    const track = { enabled: true, stop: () => stopped.push(true) };
    const mic = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    await ctl.start(mic);
    const v = voice();
    ctl.talkDown();
    ctl.end();
    await flush();
    expect(stopped).toEqual([true]);
    expect(v.closed).toBe(true);
    expect(v.gain).toBe(0);
    expect(view().screen).toBe("ended");
    expect(view().status.label).toBe("Thanks for listening");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("End from a failed connection still tears down at once", async () => {
    const { ctl, voice, started, view } = setup();
    await started();
    voice().drop("server");
    ctl.end();
    expect(view().screen).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("End during a pending answer drops late events", async () => {
    const { ctl, voice, started, typed, view } = setup();
    await started();
    const a = await typed("Q");
    const v = voice();
    ctl.end();
    v.generationStarted(a.requestId);
    expect(view().screen).toBe("ended");
  });

  it("the time limit disconnect ends the session", async () => {
    const { voice, started, view } = setup();
    await started();
    voice().drop("time_limit" as "network");
    expect(view().screen).toBe("ended");
  });

  it("a connect failure maps the server code and offers Retry", async () => {
    vi.useFakeTimers();
    const { createController } = await import("../../src/presentation/controller.js");
    const { VoiceError } = await import("../../src/voice/types.js");
    const { FakeVoiceSession } = await import("../../src/voice/fake/FakeVoiceSession.js");
    let fail = true;
    const ctl = createController({
      voiceFactory: (epoch) => {
        const v = new FakeVoiceSession({ epoch });
        if (fail) v.connect = async () => Promise.reject(new VoiceError("demo_busy"));
        return v;
      },
    });
    await ctl.start();
    expect(ctl.view().snapshot.error).toBe("demo_busy");
    expect(ctl.view().status.label).toBe("Demo is busy, try again in a minute.");
    fail = false;
    ctl.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.view().snapshot.connection).toBe("connected");
  });

  it("Restart returns to the landing screen with a fresh context", async () => {
    const { ctl, started, view } = setup();
    await started();
    ctl.goto(3);
    ctl.end();
    ctl.restart();
    expect(view().screen).toBe("landing");
    expect(view().displayedSlide).toBe("intro");
    expect(view().captions).toHaveLength(0);
  });

  it("mic_ended switches to text input with a notice", async () => {
    const { voice, started, view } = setup();
    await started();
    voice().micEnded();
    expect(view().snapshot.input).toBe("text");
    expect(view().notice).toMatch(/microphone disconnected/);
    expect(view().controls.talk).toBe(false);
  });
});

describe("captions", () => {
  it("marks an interrupted line and drops its late deltas", async () => {
    const { ctl, voice, started, last, view } = setup();
    await started();
    const s0 = last();
    voice().generationStarted(s0.requestId);
    voice().playbackStarted(s0.requestId);
    const rid = voice().responseId(s0.requestId);
    voice().agentSays(s0.requestId, "GLP-1, short for");
    ctl.talkDown();
    voice().ackInterrupt();
    const line = view().captions.find((l) => l.id === rid)!;
    expect(line.interrupted).toBe(true);
  });

  it("a late user transcript lands above the answer it triggered", async () => {
    const { voice, started, spoken, play, view } = setup();
    await started();
    const a = await spoken(600, "item_q");
    play(a.requestId, "Because of slower stomach emptying.");
    voice().userTranscript("item_q", "Why do people eat less?");
    const lines = view().captions.map((l) => [l.who, l.text]);
    const qi = lines.findIndex(([, t]) => t === "Why do people eat less?");
    const ai = lines.findIndex(([, t]) => t === "Because of slower stomach emptying.");
    expect(qi).toBeGreaterThan(-1);
    expect(qi).toBeLessThan(ai);
    expect(view().questions).toEqual(["Why do people eat less?"]);
  });

  it("adds a source line when an answer uses a numeric fact", async () => {
    const { started, typed, play, view, voice } = setup();
    await started();
    const a = await typed("How much weight?");
    play(
      a.requestId,
      "In STEP-1, people lost 14.9 percent on average versus 2.4 percent on placebo.",
    );
    const line = view().captions.find((l) => l.id === voice().responseId(a.requestId))!;
    expect(line.sources).toContain("STEP-1, Wilding, NEJM 2021");
  });
});

describe("slide notes and pruning (arch §5.10)", () => {
  const notes = (v: ReturnType<ReturnType<typeof setup>["voice"]>) =>
    v.commands
      .filter((c) => c.type === "addControllerNote")
      .map((c) => (c as { text: string }).text);

  it("adds a full note once every sentence of a slide has played", async () => {
    const { voice, started, last, play } = setup();
    await started();
    for (let i = 0; i < deck[0]!.segments.length; i++) play(last().requestId);
    expect(notes(voice())).toEqual([`Presented slide 1, What is GLP-1?: ${deck[0]!.summary}`]);
  });

  it("an interruption after a played sentence adds a partial note; none before the first", async () => {
    const { ctl, voice, started, last, play, startPlaying } = setup();
    await started();
    startPlaying(last().requestId);
    ctl.togglePause(); // nothing played yet on this slide
    expect(notes(voice())).toEqual([]);
    voice().ackInterrupt();
    ctl.togglePause();
    play(last().requestId);
    startPlaying(last().requestId);
    ctl.togglePause();
    expect(notes(voice())).toEqual(["Partly presented slide 1, up to sentence 1."]);
  });

  it("prunes the oldest pairs after six and the note carries fact ids, never user text", async () => {
    const { voice, started, typed, play } = setup();
    await started();
    for (let i = 0; i < 7; i++) {
      const a = await typed(`secret question ${i}`);
      play(a.requestId, "In SELECT, events fell from 8.0 to 6.5 percent.");
    }
    const deletes = voice().commands.filter((c) => c.type === "deleteItems");
    expect(deletes.length).toBeGreaterThan(0);
    const all = notes(voice()).join(" ");
    expect(all).toContain("Earlier questions were answered from facts evid-8");
    expect(all).not.toContain("secret");
  });

  it("deletes a cancelled answer fragment", async () => {
    const { ctl, voice, started, typed } = setup();
    await started();
    const a = await typed("Q");
    voice().generationStarted(a.requestId);
    ctl.togglePause();
    voice().generationDone(a.requestId, "cancelled", {
      hadAudio: true,
      outputItemIds: ["item_frag"],
    });
    expect(voice().commands).toContainEqual({ type: "deleteItems", ids: ["item_frag"] });
  });
});

describe("voice quality: one sentence per narration, silent turns resume", () => {
  const segment = (i: number) => deck[0]!.segments[i]!.text;
  const narrations = (reqs: { kind: string; sentenceIndex?: number }[], i: number) =>
    reqs.filter((r) => r.kind === "narration" && r.sentenceIndex === i).length;

  it("sends exactly one narration request per sentence, even with early or repeated playback_completed", async () => {
    const { voice, started, last, creates, flush } = setup();
    await started();
    const s0 = last();
    voice().generationStarted(s0.requestId);
    voice().playbackStarted(s0.requestId);
    voice().playbackCompleted(s0.requestId); // before generation_done
    voice().playbackCompleted(s0.requestId); // and again
    await flush();
    expect(narrations(creates(), 1)).toBe(0); // the generation slot is still held
    voice().generationDone(s0.requestId, "completed", { hadAudio: true });
    voice().playbackCompleted(s0.requestId);
    await flush();
    expect(narrations(creates(), 0)).toBe(1);
    expect(narrations(creates(), 1)).toBe(1);
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 1 });
  });

  it("flags and counts narration much longer than its sentence, without blocking playback", async () => {
    const { started, last, play, view, debugged } = setup();
    await started();
    play(last().requestId, segment(0));
    expect(view().debug.narrationOverruns).toBe(0);
    const s1 = last();
    const adLib =
      "GLP-1, or glucagon-like peptide-1, is a natural hormone. It helps coordinate blood sugar and digestion. ";
    play(s1.requestId, adLib + segment(1));
    expect(view().debug.narrationOverruns).toBe(1);
    const [flag] = debugged("narration_overrun");
    expect(flag?.data).toMatchObject({
      requestId: s1.requestId,
      slideId: "intro",
      sentenceIndex: 1,
    });
    expect(JSON.stringify(flag?.data)).not.toContain("hormone"); // lengths only, no transcript text
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 2 }); // playback went on
  });

  it("narrationOverrun allows small variations and a short bridge", () => {
    const s = segment(2);
    expect(narrationOverrun(s, s, false)).toBe(false);
    expect(narrationOverrun(`So, ${s}`, s, false)).toBe(false);
    expect(narrationOverrun(`As I was saying, picking up where we were, ${s}`, s, true)).toBe(
      false,
    );
    expect(narrationOverrun(`${s} ${s} ${s}`, s, true)).toBe(true);
  });

  it("an empty final transcript cancels the unheard answer and resumes narration", async () => {
    const { voice, started, startPlaying, last, spoken, flush, kinds, view, debugged } = setup();
    await started();
    startPlaying(last().requestId);
    const a = await spoken(600, "item_q");
    expect(a.kind).toBe("answer");
    voice().generationStarted(a.requestId);
    voice().userTranscript("item_q", "  ");
    voice().ackInterrupt();
    await flush();
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 0 });
    expect(kinds().filter((k) => k === "answer")).toHaveLength(1);
    expect(voice().commands).toContainEqual({ type: "deleteItems", ids: ["item_q"] });
    expect(view().captions.some((l) => l.who === "you")).toBe(false);
    expect(view().questions).toEqual([]);
    expect(view().askAgain).toBe(false);
    expect(debugged("empty_transcript_dropped")).toHaveLength(1);
  });

  it("an empty transcript that beats the commit result never requests an answer", async () => {
    const { ctl, voice, started, last, flush, kinds, view } = setup();
    await started();
    const s0 = last();
    voice().generationStarted(s0.requestId); // still generating: the barrier stays pending
    ctl.talkDown();
    vi.advanceTimersByTime(600);
    ctl.talkUp();
    await flush();
    voice().userCommitted("item_q");
    voice().userTranscript("item_q", "");
    await flush();
    voice().ackInterrupt();
    await flush();
    expect(kinds()).not.toContain("answer");
    expect(last()).toMatchObject({ kind: "narration", sentenceIndex: 0 });
    expect(last().requestId).not.toBe(s0.requestId);
    expect(voice().commands).toContainEqual({ type: "deleteItems", ids: ["item_q"] });
    expect(view().captions.some((l) => l.who === "you")).toBe(false);
  });

  it("a non-empty final transcript is answered as before", async () => {
    const { voice, started, startPlaying, last, spoken, flush, play, view } = setup();
    await started();
    startPlaying(last().requestId);
    const a = await spoken(600, "item_q");
    const interrupts = voice().commands.filter((c) => c.type === "interrupt").length;
    voice().generationStarted(a.requestId);
    voice().userTranscript("item_q", "What is GLP-1?");
    await flush();
    expect(voice().commands.filter((c) => c.type === "interrupt")).toHaveLength(interrupts);
    expect(last().requestId).toBe(a.requestId);
    play(a.requestId, "It is a gut hormone.");
    expect(view().questions).toEqual(["What is GLP-1?"]);
  });

  it("an empty transcript after the answer is audible cancels nothing", async () => {
    const { voice, started, startPlaying, last, spoken, flush, debugged } = setup();
    await started();
    startPlaying(last().requestId);
    const a = await spoken(600, "item_q");
    startPlaying(a.requestId);
    const interrupts = voice().commands.filter((c) => c.type === "interrupt").length;
    voice().userTranscript("item_q", "");
    await flush();
    expect(voice().commands.filter((c) => c.type === "interrupt")).toHaveLength(interrupts);
    expect(last().requestId).toBe(a.requestId);
    expect(debugged("empty_transcript_dropped")).toHaveLength(0);
  });
});

describe("ending by voice or text", () => {
  it("a typed end command ends at once, like End, with no answer", async () => {
    const { ctl, voice, started, kinds, view } = setup();
    await started();
    await ctl.askTyped("ya end it");
    expect(view().screen).toBe("ended");
    expect(voice().closed).toBe(true);
    expect(kinds()).not.toContain("answer");
  });

  it("a spoken end command ends when its transcript arrives", async () => {
    const { voice, started, startPlaying, last, spoken, view } = setup();
    await started();
    startPlaying(last().requestId);
    const a = await spoken(600, "item_q");
    voice().generationStarted(a.requestId);
    voice().userTranscript("item_q", "Ava, end the presentation.");
    expect(view().screen).toBe("ended");
    expect(voice().closed).toBe(true);
  });

  it("a question that mentions ending is answered, not treated as End", async () => {
    const { started, typed, view } = setup();
    await started();
    const a = await typed("How does the treatment end?");
    expect(a.kind).toBe("answer");
    expect(view().screen).toBe("live");
  });

  it("end_presentation gets exactly one tool result, then ends", async () => {
    const { voice, started, typed, view } = setup();
    await started();
    const a = await typed("I'd like to stop here please");
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c_end", "end_presentation", {});
    expect(voice().toolResults("c_end")).toHaveLength(1);
    expect(view().screen).toBe("ended");
  });

  it("offer_end speaks the fixed offer once, then pauses until Resume", async () => {
    const { ctl, voice, started, typed, last, play, flush, kinds, view } = setup();
    await started();
    const a = await typed("I'm done, thank you");
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c_offer", "offer_end", {});
    expect(voice().toolResults("c_offer")).toHaveLength(1);
    voice().generationDone(a.requestId, "completed", { hadAudio: false });
    await flush();
    const offer = last();
    expect(offer).toMatchObject({ kind: "continuation", toolChoice: "none" });
    expect(offer.instructions).toContain(
      'SENTENCE: If you\'d like to end the call, press the red stop button at the bottom of the presentation, or hold Space and say "end presentation".',
    );
    play(offer.requestId);
    await flush();
    vi.advanceTimersByTime(TIMING.resumeWindowMs + 100);
    await flush();
    expect(view().presentationStatus).toBe("paused");
    expect(view().screen).toBe("live");
    expect(kinds().filter((k) => k === "narration")).toHaveLength(1); // no narration since the offer
    ctl.resume();
    await flush();
    expect(last()).toMatchObject({ kind: "narration", slideId: "intro", sentenceIndex: 0 });
  });

  it("after the whole talk, a 'no' to final questions gets the end offer and stays finished", async () => {
    const { voice, started, typed, last, play, flush, kinds, view, creates } = setup();
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) play(last().requestId);
    expect(view().presentationStatus).toBe("finished");
    const a = await typed("No");
    expect(a.instructions).toContain("If the listener says they have no questions");
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c_offer", "offer_end", {});
    voice().generationDone(a.requestId, "completed", { hadAudio: false });
    await flush();
    const offer = last();
    expect(offer).toMatchObject({ kind: "continuation", toolChoice: "none" });
    expect(offer.instructions).toContain("press the red stop button");
    play(offer.requestId);
    await flush();
    const n = creates().length;
    vi.advanceTimersByTime(TIMING.resumeWindowMs + 100);
    await flush();
    expect(creates().length).toBe(n);
    expect(view().presentationStatus).toBe("finished");
    expect(view().screen).toBe("live");
    expect(kinds().filter((k) => k === "narration")).toHaveLength(total);
  });

  it("mid-talk questions are not told the talk has finished", async () => {
    const { started, typed } = setup();
    await started();
    const a = await typed("What is GLP-1?");
    expect(a.instructions).not.toContain("If the listener says they have no questions");
  });
});

describe("presenters (brief §6.1)", () => {
  it("starts with Ava, or the presenter restored from storage", () => {
    expect(setup().view().persona).toBe("ava");
    expect(setup({ persona: "mira" }).view().persona).toBe("mira");
  });

  it("can change the presenter on the landing page only", async () => {
    const { ctl, view, started } = setup();
    ctl.setPersona("theo");
    expect(view().persona).toBe("theo");
    ctl.micCheck();
    ctl.setPersona("mira");
    expect(view().persona).toBe("theo");
    ctl.backToLanding();
    ctl.setPersona("mira");
    expect(view().persona).toBe("mira");
    await started();
    ctl.setPersona("ava");
    expect(view().persona).toBe("mira");
  });

  it("opens the voice session for the presenter and speaks as them", async () => {
    const { ctl, mic, factoryOpts, last, play, typed } = setup();
    ctl.setPersona("theo");
    await ctl.start(mic());
    expect(factoryOpts[0]).toEqual({ persona: "theo" });
    const greeting = last();
    expect(greeting.kind).toBe("greeting");
    expect(greeting.instructions).toContain("You are Theo,");
    expect(greeting.instructions).toContain("SENTENCE: Hi, I'm Theo.");
    play(greeting.requestId);
    expect(last().instructions).toMatch(/^You are Theo,/);
    const answer = await typed("What is GLP-1?");
    expect(answer.instructions).toMatch(/^You are Theo,/);
    expect(answer.instructions).not.toContain("Ava");
  });

  it("keeps the presenter on a reconnect", async () => {
    const { voice, voices, factoryOpts, started, flush } = setup({ persona: "mira" });
    await started();
    Object.defineProperty(voice(), "sessionId", { value: "sess-1" });
    voice().drop("network");
    await flush();
    expect(voices).toHaveLength(2);
    expect(factoryOpts[1]).toEqual({ reconnectOf: "sess-1", persona: "mira" });
  });

  it("passes the presenter to backup voice answers", async () => {
    const h = setup({ backup: true, failConnects: 3, persona: "theo" });
    const starting = h.ctl.start(h.mic());
    await vi.advanceTimersByTimeAsync(2500);
    await starting;
    h.ctl.continueWithBackup();
    await h.flush();
    expect(h.view().snapshot.voice).toBe("backup");
    h.speech!.start();
    await h.ctl.askTyped("What are the side effects?");
    await h.flush();
    expect(h.chats[0]).toMatchObject({ question: "What are the side effects?", persona: "theo" });
  });

  it("with another presenter, a 'no' after the talk still gets the end offer", async () => {
    const { voice, started, typed, last, play, flush } = setup({ persona: "theo" });
    await started();
    const total = deck.reduce((n, s) => n + s.segments.length, 0);
    for (let i = 0; i < total; i++) play(last().requestId);
    const a = await typed("No");
    expect(a.instructions).toMatch(/^You are Theo,/);
    expect(a.instructions).toContain("If the listener says they have no questions");
    voice().generationStarted(a.requestId);
    voice().toolCall(a.requestId, "c_offer", "offer_end", {});
    voice().generationDone(a.requestId, "completed", { hadAudio: false });
    await flush();
    expect(last().instructions).toMatch(/^You are Theo,/);
    expect(last().instructions).toContain("press the red stop button");
  });

  it("keeps the presenter after End and Restart, and it can be changed again", async () => {
    const { ctl, view, started } = setup();
    ctl.setPersona("theo");
    await started();
    ctl.end();
    ctl.restart();
    expect(view().screen).toBe("landing");
    expect(view().persona).toBe("theo");
    ctl.setPersona("ava");
    expect(view().persona).toBe("ava");
  });
});
