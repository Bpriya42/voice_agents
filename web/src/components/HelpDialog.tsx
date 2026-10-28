import { useEffect, useRef } from "react";
import { SHORTCUT_HELP } from "../input/shortcuts.js";
import { useSession } from "../app/SessionProvider.js";

/** The shortcut list (`?`). Esc or Close dismisses it and returns focus. */
export function HelpDialog() {
  const { helpOpen, setHelpOpen } = useSession();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!helpOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => prev?.focus?.();
  }, [helpOpen]);
  if (!helpOpen) return null;
  return (
    <div className="modal-back" onClick={() => setHelpOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            setHelpOpen(false);
          }
        }}
      >
        <h2 id="help-title">Keyboard shortcuts</h2>
        <dl className="keys">
          {SHORTCUT_HELP.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <button ref={close} type="button" className="btn" onClick={() => setHelpOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
