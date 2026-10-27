import { ERROR_COPY } from "../machine/status.js";
import { useSession } from "../app/SessionProvider.js";

/** Errors with their action, Ask again, and one-line notices beside the status (arch §4.5). */
export function Notices() {
  const { view, controller } = useSession();
  const { error } = view.snapshot;
  const failed = view.snapshot.connection === "failed";
  return (
    <div className="notices">
      {(error || failed) && (
        <div className="notice error" role="alert">
          <strong>{ERROR_COPY[error ?? "session_failed"]}</strong>
          {view.controls.retry && (
            <div className="acts">
              <button
                type="button"
                className="btn"
                aria-keyshortcuts="R"
                onClick={() => controller.retry()}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
      {view.askAgain && !error && (
        <div className="notice" role="status">
          <p>That answer was cut short.</p>
          <div className="acts">
            <button
              type="button"
              className="btn"
              aria-keyshortcuts="R"
              onClick={() => controller.askAgain()}
            >
              Ask again
            </button>
            <button
              type="button"
              className="btn"
              aria-keyshortcuts="Escape"
              onClick={() => controller.dismissAskAgain()}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {view.notice && (
        <div className="notice" role="status">
          <p>{view.notice}</p>
          <div className="acts">
            <button type="button" className="btn" onClick={() => controller.dismissNotice()}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
