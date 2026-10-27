/** Oral options and the pipeline (facts future-1, future-2, future-5). */
const ROWS: [string, string, string][] = [
  ["Dec 2025", "Oral semaglutide", "approved"],
  ["Apr 2026", "Orforglipron", "approved"],
  ["Now", "Retatrutide", "investigational"],
];

export function Timeline() {
  return (
    <svg
      viewBox="0 0 320 150"
      role="img"
      aria-label="Oral semaglutide approved December 2025, orforglipron approved April 2026, retatrutide still investigational"
    >
      <line className="v-grid" x1="20" y1="60" x2="300" y2="60" />
      {ROWS.map(([when, what, status], i) => {
        const x = 55 + i * 105;
        return (
          <g key={what}>
            <circle className={i < 2 ? "v-dot" : "v-node"} cx={x} cy="60" r="6" />
            <text className="v-val" x={x} y="40" textAnchor="middle">
              {when}
            </text>
            <text className="v-lab" x={x} y="88" textAnchor="middle">
              {what}
            </text>
            <text className="v-cap" x={x} y="104" textAnchor="middle">
              {status}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
