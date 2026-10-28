import { useState } from "react";
import { useSession } from "../app/SessionProvider.js";
import { EXAMPLE_QUESTIONS } from "./Landing.js";

/**
 * The question box (brief §7.4): the first keystroke pauses Ava, clearing restores the previous
 * status, Enter sends, Esc clears. Chips send a typed question directly.
 */
export function AskBox() {
  const { view, controller, askRef } = useSession();
  const [text, setText] = useState("");
  const enabled = view.controls.ask;

  const send = (q: string) => {
    if (!q.trim()) return;
    void controller.askTyped(q);
    setText("");
  };

  return (
    <div className="ask">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          ref={askRef}
          type="text"
          aria-label="Your question"
          placeholder={enabled ? "Type a question…" : "Questions open once Ava is connected"}
          value={text}
          disabled={!enabled}
          maxLength={500}
          autoComplete="off"
          aria-keyshortcuts="/"
          onChange={(e) => {
            const next = e.target.value;
            if (!text && next) controller.typingStarted();
            if (text && !next) controller.typingCleared();
            setText(next);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            if (text) controller.typingCleared();
            setText("");
            e.currentTarget.blur();
          }}
        />
        <button
          type="submit"
          className="act"
          aria-label="Send question"
          disabled={!enabled || !text.trim()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      <details className="examples">
        <summary>Example questions</summary>
        <div className="chips">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="chip"
              disabled={!enabled}
              onClick={() => send(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
