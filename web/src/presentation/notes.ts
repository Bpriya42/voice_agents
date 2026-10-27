import { deck, type Slide, type SlideId } from "@ava/shared";

export interface QaPair {
  /** Every conversation item of the pair: user message, tool calls and results, answer. */
  itemIds: string[];
  factIds: string[];
}

export interface NotesState {
  notes: Partial<Record<SlideId, { itemId: string; full: boolean }>>;
  qaPairs: QaPair[];
  pruneNoteId: string | null;
}

export const initialNotes = (): NotesState => ({ notes: {}, qaPairs: [], pruneNoteId: null });

const slideNumber = (s: Slide) => deck.findIndex((x) => x.id === s.id) + 1;

/**
 * Slide notes follow completed playback (arch §5.10). `playedThrough` is the index of the last
 * sentence that finished playing on this slide, or -1 if none did.
 */
export function noteForPlayed(
  state: NotesState,
  slide: Slide,
  playedThrough: number,
): { add?: string; remove?: string } {
  const existing = state.notes[slide.id];
  const full = playedThrough + 1 >= slide.segments.length;
  if (existing?.full) return {};
  if (full) {
    return {
      add: `Presented slide ${slideNumber(slide)}, ${slide.title}: ${slide.summary}`,
      ...(existing ? { remove: existing.itemId } : {}),
    };
  }
  if (!existing && playedThrough >= 0) {
    return {
      add: `Partly presented slide ${slideNumber(slide)}, up to sentence ${playedThrough + 1}.`,
    };
  }
  return {};
}

/** After `keep` Q&A pairs, drop the oldest; the replacement note uses fact ids only, never user text. */
export function prunePlan(
  state: NotesState,
  keep = 6,
): { delete: string[]; note?: string; keep: QaPair[] } {
  if (state.qaPairs.length <= keep) return { delete: [], keep: state.qaPairs };
  const old = state.qaPairs.slice(0, state.qaPairs.length - keep);
  const facts = [...new Set(old.flatMap((p) => p.factIds))];
  return {
    delete: [...old.flatMap((p) => p.itemIds), ...(state.pruneNoteId ? [state.pruneNoteId] : [])],
    note: `Earlier questions were answered from facts ${facts.join(", ") || "none"}.`,
    keep: state.qaPairs.slice(-keep),
  };
}
