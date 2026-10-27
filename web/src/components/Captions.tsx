import { useEffect, useRef } from "react";
import { useSession } from "../app/SessionProvider.js";

/** Live captions (brief §7.4, §11): on by default, a selector over the caption log. */
export function Captions() {
  const { view } = useSession();
  const box = useRef<HTMLDivElement>(null);
  const lines = view.captions;

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="tx" ref={box} aria-label="Captions" data-testid="captions">
      {lines.length === 0 && <p className="tx-empty">Captions appear here.</p>}
      {lines.map((l) => (
        <div
          key={l.id}
          className={`line ${l.who === "you" ? "you" : ""} ${l.interrupted ? "cut" : ""}`}
        >
          <span className="who">{l.who === "you" ? "You" : "Ava"}</span>
          <p>
            {l.pending ? "…" : l.text}
            {l.interrupted && <span className="dash"> —</span>}
          </p>
          {l.sources.length > 0 && <p className="src">Source: {l.sources.join("; ")}</p>}
        </div>
      ))}
    </div>
  );
}
