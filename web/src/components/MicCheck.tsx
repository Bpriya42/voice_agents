import { useSession } from "../app/SessionProvider.js";
import { unlockAudio } from "../audio/context.js";
import { Waveform } from "./Waveform.js";

/** Mic check (brief §7.2) and the start step for text mode (brief §7.3). */
export function MicCheck() {
  const { controller, mic, view } = useSession();
  const { state } = mic;
  const textMode = view.screen === "ready";

  const start = async (withMic: boolean) => {
    await unlockAudio(); // the Start click is the autoplay unlock (arch §4.9)
    await controller.start(withMic ? mic.stream() : null);
  };
  const continueByTyping = () => {
    mic.release();
    controller.setupReady();
  };

  if (textMode) {
    return (
      <main className="setup">
        <div className="card">
          <p className="eyebrow">
            <span className="step-n">02 / 02</span> Typing mode
          </p>
          <h1>Ready when you are</h1>
          <p className="lede">
            You'll type your questions. Ava still speaks, and slides still change.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              autoFocus
              onClick={() => void start(false)}
            >
              Start presentation
            </button>
            <button type="button" className="btn link" onClick={() => controller.backToLanding()}>
              Back
            </button>
          </div>
        </div>
      </main>
    );
  }

  const denied = state.error === "mic_denied";
  const notFound = state.error === "mic_not_found" || state.error === "mic_error";

  return (
    <main className="setup">
      <div className="card">
        <p className="eyebrow">
          <span className="step-n">01 / 02</span> Step 1 of 2
        </p>
        <h1>Check your microphone</h1>

        {state.status === "requesting" && (
          <p className="lede" role="status">
            Your browser will ask for microphone access. Ava needs it so you can interrupt and ask
            questions out loud.
          </p>
        )}

        {denied && (
          <div className="banner error" role="alert">
            <strong>Microphone access is blocked.</strong> Click the lock icon in the address bar,
            allow the microphone for this site, then press Retry.
          </div>
        )}
        {notFound && (
          <div className="banner error" role="alert">
            <strong>We couldn't find a microphone.</strong> Plug one in or pick another device, then
            Retry.
          </div>
        )}

        {state.status === "live" && (
          <>
            <p className="lede" role="status">
              {state.heard ? "" : "Say something…"}
            </p>
            <div
              className="meter"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.level * 100)}
              data-testid="mic-meter"
            >
              <Waveform level={state.level} />
            </div>
            {state.heard && (
              <p className="ok" role="status">
                <span aria-hidden="true">✓</span> We can hear you
              </p>
            )}
            {state.silent && (
              <div className="banner" role="status">
                We can't hear anything yet. Check the mute switch or pick another microphone.
              </div>
            )}
          </>
        )}

        {state.devices.length > 1 && (
          <label className="field">
            Microphone
            <select
              value={state.deviceId ?? ""}
              onChange={(e) => void mic.selectDevice(e.target.value)}
            >
              {state.devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={!state.heard}
            onClick={() => void start(true)}
            aria-keyshortcuts="Enter"
          >
            Start presentation
          </button>
          {(state.status === "error" || state.silent) && (
            <button type="button" className="btn" onClick={() => void mic.request()}>
              {state.silent ? "Try again" : "Retry"}
            </button>
          )}
          <button type="button" className="btn link" onClick={continueByTyping}>
            Continue by typing
          </button>
        </div>
        <p className="tip">Using speakers? Headphones give the best interruption experience.</p>
      </div>
    </main>
  );
}
