import { describe, expect, it } from "vitest";
import { deck } from "@ava/shared";
import {
  answerNavigate,
  ask,
  explicitNavigate,
  initialCtx,
  questionDone,
  sentencePlayed,
  setStatus,
  showCheckpoint,
  slideAt,
  stayHere,
  type PresentationCtx,
} from "./checkpoint.js";

const at = (over: Partial<PresentationCtx> = {}): PresentationCtx => ({ ...initialCtx(), ...over });

describe("checkpoint operations (arch §4.7)", () => {
  it("Ask preserves the checkpoint and snapshots status and slide; follow-ups keep the first snapshot", () => {
    const c0 = at({
      displayedSlide: "mechanism",
      checkpoint: { slideId: "mechanism", sentenceIndex: 2 },
    });
    const c1 = ask(c0);
    expect(c1.checkpoint).toEqual(c0.checkpoint);
    expect(c1.preQuestion).toEqual({ status: "running", displayedSlide: "mechanism" });
    const c2 = ask(answerNavigate(c1, "safety"));
    expect(c2.preQuestion).toEqual({ status: "running", displayedSlide: "mechanism" });
  });

  it("Answer navigation changes only the displayed slide", () => {
    const c = answerNavigate(ask(at()), "safety");
    expect(c.displayedSlide).toBe("safety");
    expect(c.checkpoint).toEqual({ slideId: "intro", sentenceIndex: 0 });
    expect(c.status).toBe("running");
  });

  it("Explicit navigation replaces the checkpoint and keeps the status", () => {
    for (const status of ["running", "paused", "finished"] as const) {
      const c = explicitNavigate(
        at({ status, checkpoint: { slideId: "intro", sentenceIndex: 3 } }),
        "evidence",
      );
      expect(c).toMatchObject({
        displayedSlide: "evidence",
        checkpoint: { slideId: "evidence", sentenceIndex: 0 },
        status,
      });
    }
  });

  it("Explicit navigation during a question moves the restore slide too", () => {
    const c = explicitNavigate(ask(at({ status: "finished", displayedSlide: "future" })), "uses");
    expect(c.preQuestion).toEqual({ status: "finished", displayedSlide: "uses" });
  });

  it("Stay here moves the checkpoint to the displayed slide's first sentence and keeps status", () => {
    const c = stayHere(answerNavigate(ask(at({ status: "paused" })), "safety"));
    expect(c.checkpoint).toEqual({ slideId: "safety", sentenceIndex: 0 });
    expect(c.status).toBe("paused");
    expect(c.preQuestion?.displayedSlide).toBe("safety");
  });

  it("A running question ends in awaitResume and keeps the answer slide until the window ends", () => {
    const { ctx, next } = questionDone(answerNavigate(ask(at()), "safety"));
    expect(next).toBe("awaitResume");
    expect(ctx.displayedSlide).toBe("safety");
    expect(ctx.preQuestion).toBeNull();
    expect(showCheckpoint(ctx).displayedSlide).toBe("intro");
  });

  it("A paused question restores the checkpoint slide and stays paused", () => {
    const c = answerNavigate(
      ask(
        at({
          status: "paused",
          checkpoint: { slideId: "uses", sentenceIndex: 1 },
          displayedSlide: "uses",
        }),
      ),
      "safety",
    );
    const { ctx, next } = questionDone(c);
    expect(next).toBe("idle");
    expect(ctx).toMatchObject({ status: "paused", displayedSlide: "uses" });
  });

  it("A finished question returns silently to the slide displayed when it started", () => {
    const c = answerNavigate(
      ask(
        at({
          status: "finished",
          displayedSlide: "evidence",
          checkpoint: { slideId: "future", sentenceIndex: 0 },
        }),
      ),
      "safety",
    );
    const { ctx, next } = questionDone(c);
    expect(next).toBe("idle");
    expect(ctx).toMatchObject({ status: "finished", displayedSlide: "evidence" });
  });

  it("questionDone without a snapshot uses the current status", () => {
    expect(questionDone(at({ status: "paused" })).next).toBe("idle");
  });

  it("Pause and resume update the status the question restores", () => {
    const c = setStatus(ask(at()), "paused");
    expect(c.status).toBe("paused");
    expect(c.preQuestion?.status).toBe("paused");
    expect(setStatus(at(), "paused").preQuestion).toBeNull();
  });

  it("A played sentence advances, crosses slides and finishes only after the last segment", () => {
    let c = at();
    let r = sentencePlayed(c);
    expect(r).toMatchObject({
      finished: false,
      slideDone: false,
      ctx: { checkpoint: { slideId: "intro", sentenceIndex: 1 }, coveredSlides: ["intro"] },
    });
    c = at({ checkpoint: { slideId: "intro", sentenceIndex: deck[0]!.segments.length - 1 } });
    r = sentencePlayed(c);
    expect(r).toMatchObject({
      finished: false,
      slideDone: true,
      ctx: { checkpoint: { slideId: "mechanism", sentenceIndex: 0 } },
    });
    const last = deck.at(-1)!;
    c = at({
      checkpoint: { slideId: last.id, sentenceIndex: last.segments.length - 1 },
      coveredSlides: [last.id],
    });
    r = sentencePlayed(c);
    expect(r.finished).toBe(true);
    expect(r.ctx.status).toBe("finished");
    expect(r.ctx.checkpoint).toEqual({ slideId: "future", sentenceIndex: 0 });
    expect(r.ctx.coveredSlides).toEqual([last.id]);
  });

  it("slideAt guards the range", () => {
    expect(slideAt(0)).toBe("intro");
    expect(slideAt(-1)).toBeNull();
    expect(slideAt(6)).toBeNull();
  });
});
