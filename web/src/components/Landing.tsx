import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { deck, personaById, PRODUCT_NAME } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";
import { CoverMotif } from "./CoverMotif.js";
import { PresenterPicker } from "./PresenterPicker.js";

export const EXAMPLE_QUESTIONS = [
  "What are the side effects?",
  "How much weight do people lose?",
  "Is there a pill version?",
];

/** First screen (brief §7.1): an editorial cover that explains itself in five seconds. */
export function Landing() {
  const { controller, mic, health, healthError, view } = useSession();
  const reduce = useReducedMotion();
  const { name } = personaById(view.persona);
  const notConfigured = health ? !health.configured || health.keyValid === false : false;
  const repo = health?.public.repoUrl;

  return (
    <main className="cover">
      <header className="masthead">
        <span>
          {PRODUCT_NAME} · A talk with {name}
        </span>
        <span>{deck.length} chapters · voice presentation</span>
      </header>

      <div className="cover-grid">
        <section className="cover-main">
          <p className="eyebrow">Voice presentation demo</p>
          <h1 className="display">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={name}
                className="display-name"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
                transition={{ duration: reduce ? 0 : 0.18, ease: [0.2, 0.7, 0.2, 1] }}
              >
                {name}
              </motion.span>
            </AnimatePresence>{" "}
            explains <em>GLP-1</em> medicines
          </h1>
          <p className="lede">A 3-minute spoken talk on how GLP-1 medicines work.</p>
          <p className="hint">
            <strong>Interrupt anytime — hold Space to talk.</strong>
          </p>

          <PresenterPicker />

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
              className="btn primary lg"
              onClick={() => {
                controller.micCheck();
                void mic.request();
              }}
            >
              Check microphone <span aria-hidden="true">→</span>
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

          <div className="ask-try">
            <p className="label">Try asking</p>
            <div className="chips" aria-label="Example questions">
              {EXAMPLE_QUESTIONS.map((q) => (
                <span key={q} className="chip static">
                  {q}
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="cover-side">
          <CoverMotif />
          <ol className="toc" aria-label="Chapters">
            {deck.map((s, i) => (
              <li key={s.id} style={{ "--i": i } as CSSProperties}>
                <span className="toc-n">{String(i + 1).padStart(2, "0")}</span>
                <span>{s.title}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="cover-foot">
        <p className="privacy">
          Nothing you say is stored by this demo. Audio is processed by OpenAI to run the
          conversation.
        </p>
        <p className="privacy">Educational demo — not medical advice.</p>
      </footer>
    </main>
  );
}
