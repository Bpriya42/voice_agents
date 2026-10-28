import { useSession } from "../app/SessionProvider.js";

export const EXAMPLE_QUESTIONS = [
  "What are the side effects?",
  "How much weight do people lose?",
  "Is there a pill version?",
];

/** First screen (brief §7.1): explains itself in five seconds. */
export function Landing() {
  const { controller, mic, health, healthError } = useSession();
  const notConfigured = health ? !health.configured || health.keyValid === false : false;
  const repo = health?.public.repoUrl;

  return (
    <main className="setup">
      <div className="card landing">
        <p className="eyebrow">Voice presentation demo</p>
        <h1>Ava explains GLP-1 medicines</h1>
        <p className="lede">A 3-minute spoken talk on how GLP-1 medicines work.</p>
        <p className="hint">
          <strong>Interrupt anytime — hold Space to talk.</strong>
        </p>
        <div className="chips" aria-label="Example questions">
          {EXAMPLE_QUESTIONS.map((q) => (
            <span key={q} className="chip static">
              {q}
            </span>
          ))}
        </div>

        {notConfigured && (
          <div className="banner error" role="alert">
            Server isn't configured — see README.
          </div>
        )}
        {healthError === "backend_unreachable" && (
          <div className="banner error" role="alert">
            Our server isn't responding. Check that <code>npm run dev</code> is running.
          </div>
        )}
        {health?.limits.paused && (
          <div className="banner" role="status">
            The hosted demo is paused for this month.{" "}
            {repo && <a href={repo}>Run it locally from the repo.</a>}
          </div>
        )}
        {health?.limits.busy && !health.limits.paused && (
          <div className="banner" role="status">
            Demo is busy, try again in a minute. {repo && <a href={repo}>Or run it locally.</a>}
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              controller.micCheck();
              void mic.request();
            }}
          >
            Check microphone
          </button>
          <button
            type="button"
            className="btn link"
            onClick={() => {
              mic.release();
              controller.setupReady();
            }}
          >
            Continue without mic (type instead)
          </button>
        </div>
        <p className="privacy">
          Nothing you say is stored by this demo. Audio is processed by OpenAI to run the
          conversation.
        </p>
      </div>
    </main>
  );
}
