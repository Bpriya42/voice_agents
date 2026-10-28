import { reconnectNote, type SlideId } from "@ava/shared";
import type { VoiceSession } from "../voice/types.js";
import type { Checkpoint, Status } from "./checkpoint.js";

/** Delays before each connect attempt: now, then 0.5 s and 2 s (arch §6.2 `session_failed`). */
export const BACKOFF_MS = [0, 500, 2000] as const;
/** Completed Q&A pairs replayed into a new session (arch §5.7). */
export const REPLAY_PAIRS = 3;

export type Phase = "greeting" | "narrating" | "awaitingResume" | "finished";
export interface Qa {
  q: string;
  a: string;
}

/** What the controller knows at the moment the old transport goes away (arch §6.3 step 1). */
export interface Snapshot {
  displayedSlide: SlideId;
  checkpoint: Checkpoint;
  status: Status;
  coveredSlides: SlideId[];
  phase: Phase;
  /** The question in flight, if any. `text` is empty when it was spoken and never transcribed. */
  question: { text: string; submitted: boolean } | null;
}

export interface RestorePlan {
  phase: Phase;
  /** Lead-in for the next narration sentence; absent when nothing should be said. */
  bridge?: "reconnect" | "return";
  /** An unanswered question is offered back as Ask again (never resent silently). */
  askAgain: string | null;
  notice: string | null;
}

export const LOST_QUESTION = "That question was lost in the reconnect — ask again.";

/**
 * Where the talk goes after a new voice session is up (arch §6.3 table). Paused and finished stay
 * silent: the controller only narrates while the status is running, and the status is untouched.
 */
export function restorePlan(s: Snapshot): RestorePlan {
  if (s.question?.submitted && s.question.text.trim()) {
    return { phase: "narrating", askAgain: s.question.text, notice: null };
  }
  const lost = s.question !== null;
  const base: RestorePlan = {
    phase: "narrating",
    askAgain: null,
    notice: lost ? LOST_QUESTION : null,
  };
  if (s.phase === "finished") return { ...base, phase: "finished" };
  if (s.phase === "greeting") return base; // start slide 1 without re-greeting
  return {
    ...base,
    bridge: s.displayedSlide === s.checkpoint.slideId ? "reconnect" : "return",
  };
}

/**
 * Seeds a fresh session (arch §5.7). The note is trusted controller text built from deck data;
 * earlier exchanges are replayed in their original roles, never as a system item.
 */
export async function seedVoice(
  voice: Pick<VoiceSession, "addControllerNote" | "sendUserText" | "addAssistantText">,
  s: Pick<Snapshot, "displayedSlide" | "checkpoint" | "status" | "coveredSlides">,
  completed: readonly Qa[],
) {
  await voice.addControllerNote(
    reconnectNote({
      displayedSlide: s.displayedSlide,
      checkpoint: s.checkpoint,
      status: s.status,
      coveredSlides: s.coveredSlides,
    }),
  );
  for (const qa of completed.slice(-REPLAY_PAIRS)) {
    voice.sendUserText(qa.q);
    voice.addAssistantText(qa.a);
  }
}

export type RetryResult<T> =
  { status: "ok"; value: T } | { status: "failed"; error: unknown } | { status: "cancelled" };

export interface RetryDeps<T> {
  attempt(): Promise<T>;
  /** Resolves false when the wait was cancelled (End, a newer epoch). */
  sleep(ms: number): Promise<boolean>;
  isCurrent(): boolean;
  /** Errors a retry cannot fix (no credit, paused, busy) stop the loop at once. */
  retryable(error: unknown): boolean;
}

/** Up to three attempts with backoff. End during any wait or attempt cancels the loop. */
export async function connectWithRetry<T>(deps: RetryDeps<T>): Promise<RetryResult<T>> {
  let last: unknown;
  for (const delay of BACKOFF_MS) {
    if (delay > 0 && !(await deps.sleep(delay))) return { status: "cancelled" };
    if (!deps.isCurrent()) return { status: "cancelled" };
    try {
      const value = await deps.attempt();
      return deps.isCurrent() ? { status: "ok", value } : { status: "cancelled" };
    } catch (e) {
      if (!deps.isCurrent()) return { status: "cancelled" };
      last = e;
      if (!deps.retryable(e)) break;
    }
  }
  return { status: "failed", error: last };
}
