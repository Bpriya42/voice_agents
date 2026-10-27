import { deck, type SlideId } from "@ava/shared";

export type Status = "running" | "paused" | "finished";
export interface Checkpoint {
  slideId: SlideId;
  sentenceIndex: number;
}
export interface PresentationCtx {
  displayedSlide: SlideId;
  checkpoint: Checkpoint;
  status: Status;
  /** What to restore after the current question; follow-ups keep the first snapshot. */
  preQuestion: { status: Status; displayedSlide: SlideId } | null;
  coveredSlides: SlideId[];
}

export const initialCtx = (): PresentationCtx => ({
  displayedSlide: "intro",
  checkpoint: { slideId: "intro", sentenceIndex: 0 },
  status: "running",
  preQuestion: null,
  coveredSlides: [],
});

export const indexOf = (id: SlideId) => deck.findIndex((s) => s.id === id);
export const slideAt = (i: number): SlideId | null => deck[i]?.id ?? null;

/** Ask: keep the checkpoint; remember what to restore. Follow-ups keep the first snapshot. */
export const ask = (c: PresentationCtx): PresentationCtx => ({
  ...c,
  preQuestion: c.preQuestion ?? { status: c.status, displayedSlide: c.displayedSlide },
});

/** goto_slide intent "answer": only the displayed slide changes. */
export const answerNavigate = (c: PresentationCtx, to: SlideId): PresentationCtx => ({
  ...c,
  displayedSlide: to,
});

/** Arrows, 1–6, dots, goto_slide "user_request": replace the checkpoint, keep the status. */
export const explicitNavigate = (c: PresentationCtx, to: SlideId): PresentationCtx => ({
  ...c,
  displayedSlide: to,
  checkpoint: { slideId: to, sentenceIndex: 0 },
  preQuestion: c.preQuestion && { ...c.preQuestion, displayedSlide: to },
});

/**
 * Stay here / goto_slide "stay": the checkpoint moves to the displayed slide's first sentence.
 * The pre-question slide follows too, so a finished talk doesn't jump back after the answer.
 */
export const stayHere = (c: PresentationCtx): PresentationCtx => ({
  ...c,
  checkpoint: { slideId: c.displayedSlide, sentenceIndex: 0 },
  preQuestion: c.preQuestion && { ...c.preQuestion, displayedSlide: c.displayedSlide },
});

/** Pause / resume change the live status and the status the current question restores. */
export const setStatus = (c: PresentationCtx, status: Status): PresentationCtx => ({
  ...c,
  status,
  preQuestion: c.preQuestion && { ...c.preQuestion, status },
});

/** The answer's final playback finished and no tools remain. */
export function questionDone(c: PresentationCtx): {
  ctx: PresentationCtx;
  next: "awaitResume" | "idle";
} {
  const pre = c.preQuestion ?? { status: c.status, displayedSlide: c.displayedSlide };
  if (pre.status === "running") {
    return { ctx: { ...c, status: "running", preQuestion: null }, next: "awaitResume" };
  }
  const displayedSlide = pre.status === "paused" ? c.checkpoint.slideId : pre.displayedSlide;
  return { ctx: { ...c, preQuestion: null, status: pre.status, displayedSlide }, next: "idle" };
}

/** Narration is about to (re)start: the checkpoint's slide is shown (arch §4.10). */
export const showCheckpoint = (c: PresentationCtx): PresentationCtx =>
  c.displayedSlide === c.checkpoint.slideId ? c : { ...c, displayedSlide: c.checkpoint.slideId };

/** A narration sentence finished playing: advance, or finish after the last sentence of the last slide. */
export function sentencePlayed(c: PresentationCtx): {
  ctx: PresentationCtx;
  finished: boolean;
  slideDone: boolean;
} {
  const slide = deck[indexOf(c.checkpoint.slideId)]!;
  const coveredSlides = c.coveredSlides.includes(slide.id)
    ? c.coveredSlides
    : [...c.coveredSlides, slide.id];
  if (c.checkpoint.sentenceIndex + 1 < slide.segments.length) {
    return {
      ctx: {
        ...c,
        coveredSlides,
        checkpoint: { slideId: slide.id, sentenceIndex: c.checkpoint.sentenceIndex + 1 },
      },
      finished: false,
      slideDone: false,
    };
  }
  const next = deck[indexOf(slide.id) + 1];
  if (!next) {
    return {
      ctx: {
        ...c,
        coveredSlides,
        status: "finished",
        checkpoint: { slideId: slide.id, sentenceIndex: 0 },
      },
      finished: true,
      slideDone: true,
    };
  }
  return {
    ctx: { ...c, coveredSlides, checkpoint: { slideId: next.id, sentenceIndex: 0 } },
    finished: false,
    slideDone: true,
  };
}
