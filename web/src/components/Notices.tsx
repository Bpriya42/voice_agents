import { personaById } from "@ava/shared";
import { ERROR_ACTIONS, ERROR_COPY, ERROR_HELP } from "../machine/status.js";
import { useSession } from "../app/SessionProvider.js";
import { ScriptPanel } from "./ScriptPanel.js";

/** Errors with their action, Ask again, and one-line notices beside the status (arch §4.5, §6.2). */
export function Notices() {
  const { view, controller, health, mic, tryMic, pickMic } = useSession();
  const { error } = view.snapshot;
  const failed = view.snapshot.connection === "failed";
  const code = error ?? "session_failed";
  const actions = ERROR_ACTIONS[code];
  const help = ERROR_HELP[code];
  const repoUrl = health?.public.repoUrl;
  const inputs = mic.state.devices;
  return (
    <div className="notices">
      {(error || failed) && (
        <div className="notice error" role="alert">
          <strong>{ERROR_COPY[code]}</strong>
          {help && <p>{help}</p>}
          <div className="acts">
            {view.controls.retry && actions.includes("retry") && (
              <button
                type="button"
                className="btn"
                aria-keyshortcuts="R"
                onClick={() => controller.retry()}
              >
                Retry
              </button>
            )}
            {view.canBackup && (
              <button type="button" className="btn" onClick={() => controller.continueWithBackup()}>
                Continue with backup voice
              </button>
            )}
            {actions.includes("repo") && repoUrl && (
              <a className="btn" href={repoUrl} target="_blank" rel="noreferrer">
                Run it locally
              </a>
            )}
          </div>
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
      {view.canTryLive && (
        <div className="notice" data-testid="try-live">
          <p>
            {view.snapshot.voice === "offline"
              ? "Live voice returns when you're back online."
              : `${personaById(view.persona).name} is using the browser's voice.`}
          </p>
          <div className="acts">
            <button type="button" className="btn" onClick={() => controller.tryLiveAgain()}>
              Try live voice again
            </button>
          </div>
        </div>
      )}
      {view.canTryMic && (
        <div className="notice" data-testid="try-mic">
          <div className="acts">
            <button type="button" className="btn" onClick={() => void tryMic()}>
              Try microphone again
            </button>
            {inputs.length > 1 && (
              <select
                aria-label="Microphone"
                defaultValue=""
                onChange={(e) => e.target.value && void pickMic(e.target.value)}
              >
                <option value="" disabled>
                  Choose a microphone
                </option>
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Microphone"}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
      <ScriptPanel />
    </div>
  );
}
