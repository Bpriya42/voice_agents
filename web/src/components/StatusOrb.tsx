import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useSession } from "../app/SessionProvider.js";
import type { OrbState } from "../machine/status.js";

const ICON: Record<OrbState, string> = {
  connecting: "…",
  speaking: "",
  listening: "",
  thinking: "",
  paused: "❚❚",
  ready: "",
  text: "⌨",
  error: "!",
  ended: "",
};

/**
 * The status orb (brief §8): shape or motion + colour + a text label. Tap to start talking and
 * tap again to send; the ring follows the mic level while listening and the post-gate output
 * level while speaking.
 */
export function StatusOrb() {
  const { view, controller, mic } = useSession();
  const reduce = useReducedMotion();
  const ring = useRef<HTMLSpanElement>(null);
  const micLevel = useRef(0);
  micLevel.current = mic.state.level;

  useEffect(() => {
    if (reduce || (view.orb !== "speaking" && view.orb !== "listening")) {
      ring.current?.style.setProperty("--lvl", "0");
      return;
    }
    let raf = 0;
    const tick = () => {
      const lvl = view.orb === "speaking" ? controller.outputLevel() : micLevel.current;
      ring.current?.style.setProperty("--lvl", lvl.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view.orb, reduce, controller]);

  const capturing = view.capturing !== null;
  const label = !view.controls.talk
    ? "Voice input unavailable"
    : capturing
      ? "Tap to send"
      : "Tap to talk";

  return (
    <div className="status" data-state={view.orb} data-tone={view.status.tone}>
      <button
        type="button"
        className="orb"
        aria-label={label}
        aria-keyshortcuts="Space"
        aria-pressed={capturing}
        disabled={!view.controls.talk && !capturing}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          controller.orbPress();
        }}
        onPointerCancel={() => controller.orbCancel()}
        onClick={(e) => {
          // Keyboard activation (Enter) has detail 0; pointer taps were handled on pointerdown.
          if (e.detail === 0) controller.orbPress();
        }}
      >
        <span className="orb-ring" ref={ring} aria-hidden="true" />
        <span className="orb-core" aria-hidden="true">
          {view.orb === "speaking" || view.orb === "listening" ? (
            <span className="bars">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : view.orb === "thinking" ? (
            <span className="think">
              <i />
              <i />
              <i />
            </span>
          ) : view.orb === "ready" ? (
            <MicIcon />
          ) : (
            ICON[view.orb]
          )}
        </span>
      </button>
      <p className="st-main" data-testid="status" aria-live="polite">
        {view.status.label}
      </p>
      {view.snapshot.voice === "backup" && (
        <p className="st-sub">
          <span className="tag" data-testid="voice-tag">
            Backup voice
          </span>
        </p>
      )}
      {view.snapshot.voice === "offline" && (
        <p className="st-sub">
          <span className="tag" data-testid="voice-tag">
            Offline
          </span>
        </p>
      )}
      {view.snapshot.input === "text" &&
        view.snapshot.voice === "live" &&
        view.snapshot.connection === "connected" && (
          <p className="st-sub">Text mode — Ava still speaks</p>
        )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
      className="ico"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
