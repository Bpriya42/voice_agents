import { useState } from "react";
import { deck } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/** After End (brief §7.5): a colophon with the chapters, the session's questions, Restart. Nothing is saved. */
export function EndScreen() {
  const { view, controller, mic } = useSession();
  const [copied, setCopied] = useState(false);
  const questions = view.questions;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(questions.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="colophon">
      <header className="masthead">
        <span>A talk with Ava</span>
        <span>Fin</span>
      </header>
      <div className="colo-body">
        <p className="eyebrow">The end</p>
        <h1 className="display">Thanks for listening</h1>
        <p className="lede">The microphone is released and the voice session is closed.</p>

        <div className="colo-cols">
          <section>
            <h2 className="label">Chapters</h2>
            <ol className="toc">
              {deck.map((s, i) => (
                <li key={s.id}>
                  <span className="toc-n">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s.title}</span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="label">Questions you asked</h2>
            {questions.length > 0 ? (
              <ul className="qlist">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No questions this time.</p>
            )}
          </section>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn primary lg"
            autoFocus
            onClick={() => {
              mic.release();
              controller.restart();
            }}
          >
            Restart
          </button>
          {questions.length > 0 && (
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy questions"}
            </button>
          )}
        </div>
        <p className="privacy">Educational demo — not medical advice. Nothing was saved.</p>
      </div>
    </main>
  );
}
