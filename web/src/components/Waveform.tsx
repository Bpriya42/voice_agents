import { useEffect, useRef, useState, type CSSProperties } from "react";

const BARS = 40;

/** A scrolling bar waveform of recent mic levels (0–1, from meterValue); purely visual. */
export function Waveform({ level }: { level: number }) {
  const history = useRef<number[]>(Array.from({ length: BARS }, () => 0));
  const [, tick] = useState(0);

  useEffect(() => {
    history.current = [...history.current.slice(1), level];
    tick((n) => n + 1);
  }, [level]);

  return (
    <span className="wave" aria-hidden="true">
      {history.current.map((v, i) => (
        <i
          key={i}
          style={{ transform: `scaleY(${Math.max(0.04, v)})`, "--v": v } as CSSProperties}
        />
      ))}
    </span>
  );
}
