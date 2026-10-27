import { deck } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/** Slide dots, previous / pause / next, help and End (brief §7.4). Every control has a shortcut. */
export function Controls() {
  const { view, controller, setHelpOpen } = useSession();
  const paused = view.presentationStatus !== "running";
  const { controls } = view;
  return (
    <div className="bar">
      <div className="dots" role="group" aria-label="Slides">
        {deck.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`dot-btn ${view.displayedSlide === s.id ? "on" : ""} ${view.checkpoint.slideId === s.id && view.displayedSlide !== s.id ? "ghost" : ""}`}
            aria-label={`Go to slide ${i + 1}: ${s.title}`}
            aria-current={view.displayedSlide === s.id ? "true" : undefined}
            aria-keyshortcuts={String(i + 1)}
            disabled={!controls.navigate}
            onClick={() => controller.goto(i)}
          >
            <i />
          </button>
        ))}
        <span className="counter" aria-hidden="true">
          {view.slideIndex + 1} / {deck.length}
        </span>
      </div>
      <div className="ctrls">
        <button
          type="button"
          className="ctl"
          aria-label="Previous slide"
          aria-keyshortcuts="ArrowLeft"
          disabled={!controls.navigate || view.slideIndex === 0}
          onClick={() => controller.prev()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Previous</span>
        </button>
        <button
          type="button"
          className="ctl"
          aria-label={paused ? "Resume" : "Pause"}
          aria-keyshortcuts="P"
          aria-pressed={paused}
          disabled={!controls.pause}
          onClick={() => controller.togglePause()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {paused ? <path d="M8 5l11 7-11 7z" /> : <path d="M9 5v14M15 5v14" />}
          </svg>
          <span>{paused ? "Resume" : "Pause"}</span>
        </button>
        <button
          type="button"
          className="ctl"
          aria-label="Next slide"
          aria-keyshortcuts="ArrowRight"
          disabled={!controls.navigate || view.slideIndex === deck.length - 1}
          onClick={() => controller.next()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span>Next</span>
        </button>
        <span className="ctl-sep" aria-hidden="true" />
        <button
          type="button"
          className="ctl"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="Shift+?"
          onClick={() => setHelpOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
          </svg>
          <span>Keys</span>
        </button>
        <button
          type="button"
          className="ctl end"
          aria-label="End presentation"
          aria-keyshortcuts="Shift+E"
          disabled={!controls.end}
          onClick={() => controller.end()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <span>End</span>
        </button>
      </div>
    </div>
  );
}
