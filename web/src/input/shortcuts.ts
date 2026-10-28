export type Action =
  | "talkDown"
  | "talkUp"
  | "pause"
  | "prev"
  | "next"
  | "goto"
  | "focusAsk"
  | "stay"
  | "retry"
  | "end"
  | "mute"
  | "help"
  | "escape"
  /** Window blur or hidden document: cancels a held turn without submitting, then pauses (brief §9). */
  | "focusLost";

export interface ShortcutAction {
  action: Action;
  slide?: number;
}

type KeyInfo = Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "repeat" | "type"> &
  Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">>;

/** One table for every shortcut in brief §9. */
export function keyToAction(e: KeyInfo): ShortcutAction | null {
  if (e.repeat) return null; // auto-repeat is ignored
  // Browser and OS shortcuts (Ctrl+R, Cmd+1 …) are never taken over.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === "Space") return { action: e.type === "keydown" ? "talkDown" : "talkUp" };
  if (e.type !== "keydown") return null;
  if (e.key === "Escape") return { action: "escape" };
  if (e.shiftKey && e.key.toLowerCase() === "e") return { action: "end" };
  const k = e.key.toLowerCase();
  if (k === "p") return { action: "pause" };
  if (e.key === "ArrowLeft") return { action: "prev" };
  if (e.key === "ArrowRight") return { action: "next" };
  if (/^[1-6]$/.test(e.key)) return { action: "goto", slide: Number(e.key) - 1 };
  if (e.key === "/") return { action: "focusAsk" };
  if (e.key === "?") return { action: "help" };
  if (e.shiftKey) return null;
  if (k === "s") return { action: "stay" };
  if (k === "r") return { action: "retry" };
  if (k === "m") return { action: "mute" };
  return null;
}

/** Typing, editable content and dialogs keep their keys (Esc excepted). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
    t.closest("[role=dialog]") !== null
  );
}

/** Shown in the help dialog; kept next to the table so the two never drift. */
export const SHORTCUT_HELP: [string, string][] = [
  ["Hold Space", "Talk; release to send"],
  ["Esc", "Cancel the turn, clear the question box, or close a notice"],
  ["P", "Pause / resume"],
  ["← / →", "Previous / next slide"],
  ["1–6", "Jump to a slide"],
  ["/", "Focus the question box"],
  ["Enter", "Send the typed question"],
  ["S", "Stay on this slide after an answer jump"],
  ["R", "Retry after an error"],
  ["Shift+E", "End the presentation"],
  ["?", "Show this list"],
];
