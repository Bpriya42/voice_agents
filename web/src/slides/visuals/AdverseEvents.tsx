/** STEP-1 adverse events to scale (facts safe-1, safe-2). */
const ROWS: { label: string; drug: number; placebo: number }[] = [
  { label: "Any gut-related event", drug: 74.2, placebo: 47.9 },
  { label: "Stopped because of gut events", drug: 4.5, placebo: 0.8 },
];

const w = (v: number) => (v / 100) * 200;

export function AdverseEvents() {
  return (
    <svg
      viewBox="0 0 320 172"
      role="img"
      aria-label="STEP-1: gut-related events 74.2% with semaglutide versus 47.9% with placebo; stopped because of gut events 4.5% versus 0.8%"
    >
      <text className="v-cap" x="20" y="14">
        STEP-1, % of participants
      </text>
      {ROWS.map((r, i) => {
        const y0 = 34 + i * 62;
        return (
          <g key={r.label}>
            <text className="v-lab" x="20" y={y0}>
              {r.label}
            </text>
            <rect className="v-bar" x="20" y={y0 + 8} width={w(r.drug)} height="14" rx="2" />
            <text className="v-val" x={26 + w(r.drug)} y={y0 + 19}>
              {r.drug}%
            </text>
            <rect className="v-bar2" x="20" y={y0 + 26} width={w(r.placebo)} height="14" rx="2" />
            <text className="v-val" x={26 + w(r.placebo)} y={y0 + 37}>
              {r.placebo}%
            </text>
          </g>
        );
      })}
      <rect className="v-bar" x="20" y="152" width="8" height="8" rx="1" />
      <text className="v-cap" x="32" y="160">
        Semaglutide 2.4 mg
      </text>
      <rect className="v-bar2" x="140" y="152" width="8" height="8" rx="1" />
      <text className="v-cap" x="152" y="160">
        Placebo
      </text>
    </svg>
  );
}
