import { useEffect, useRef } from "react";
import { isEditableTarget, keyToAction, type ShortcutAction } from "./shortcuts.js";

/**
 * One global listener in the capture phase (arch §4.7). Editable targets and dialogs keep their
 * keys; the question box and the help dialog handle their own Esc and Enter.
 */
export function useShortcuts(onAction: (a: ShortcutAction) => void, enabled = true) {
  const handler = useRef(onAction);
  handler.current = onAction;

  useEffect(() => {
    if (!enabled) return;
    let spaceHeld = false;

    const onKey = (e: KeyboardEvent) => {
      // A held Space always gets its release, wherever focus went in between.
      if (e.code === "Space" && e.type === "keyup" && spaceHeld) {
        spaceHeld = false;
        e.preventDefault();
        handler.current({ action: "talkUp" });
        return;
      }
      if (isEditableTarget(e.target)) return;
      // Space never scrolls the page or activates a focused button, even on auto-repeat.
      if (e.code === "Space") e.preventDefault();
      const a = keyToAction(e);
      if (!a) return;
      if (a.action === "talkDown") spaceHeld = true;
      if (a.action === "talkUp") return; // only a release that follows our own press counts
      if (a.action !== "escape") e.preventDefault();
      handler.current(a);
    };

    const onFocusLost = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        if (spaceHeld) spaceHeld = false;
        handler.current({ action: "focusLost" });
      }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKey, { capture: true });
    window.addEventListener("blur", onFocusLost);
    document.addEventListener("visibilitychange", onFocusLost);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKey, { capture: true });
      window.removeEventListener("blur", onFocusLost);
      document.removeEventListener("visibilitychange", onFocusLost);
    };
  }, [enabled]);
}
