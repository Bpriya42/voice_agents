import { useSession } from "../app/SessionProvider.js";

/** After End (brief §7.5): a thank-you line, the session's questions, Restart. Nothing is saved. */
export function EndScreen() {
  const { view, controller, mic } = useSession();
  return (
    <main className="setup">
      <div className="card">
        <h1>Thanks for listening</h1>
        <p className="lede">The microphone is released and the voice session is closed.</p>
        {view.questions.length > 0 && (
          <>
            <h2 className="sub">Questions you asked</h2>
            <ul className="qlist">
              {view.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </>
        )}
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            autoFocus
            onClick={() => {
              mic.release();
              controller.restart();
            }}
          >
            Restart
          </button>
        </div>
      </div>
    </main>
  );
}
