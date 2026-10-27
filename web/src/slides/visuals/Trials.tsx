/** Mean weight loss to scale (facts evid-2, evid-5). */
const GROUPS: { trial: string; drug: string; drugValue: number; placebo: number }[] = [
  { trial: "STEP-1 · 68 wk", drug: "Semaglutide 2.4 mg", drugValue: 14.9, placebo: 2.4 },
  { trial: "SURMOUNT-1 · 72 wk", drug: "Tirzepatide 15 mg", drugValue: 20.9, placebo: 3.1 },
];

const y = (v: number) => 160 - (v / 25) * 130;

function Bar({ x, v, cls }: { x: number; v: number; cls: string }) {
  return (
    <g>
      <rect className={cls} x={x} y={y(v)} width="36" height={160 - y(v)} rx="2" />
      <text className="v-val" x={x + 18} y={y(v) - 5} textAnchor="middle">
        {v}%
      </text>
    </g>
  );
}

export function Trials() {
  return (
    <svg
      viewBox="0 0 320 204"
      role="img"
      aria-label="Mean weight loss: STEP-1 semaglutide 14.9% versus placebo 2.4%; SURMOUNT-1 tirzepatide 20.9% versus placebo 3.1%"
    >
      <text className="v-cap" x="20" y="12">
        Mean weight loss, %
      </text>
      <rect className="v-bar" x="196" y="4" width="8" height="8" rx="1" />
      <text className="v-cap" x="208" y="12">
        Drug
      </text>
      <rect className="v-bar2" x="244" y="4" width="8" height="8" rx="1" />
      <text className="v-cap" x="256" y="12">
        Placebo
      </text>
      <line className="v-grid" x1="20" y1="160" x2="300" y2="160" />
      {GROUPS.map((g, i) => {
        const x0 = 50 + i * 140;
        return (
          <g key={g.trial}>
            <Bar x={x0} v={g.drugValue} cls="v-bar" />
            <Bar x={x0 + 42} v={g.placebo} cls="v-bar2" />
            <text className="v-lab" x={x0 + 39} y="178" textAnchor="middle">
              {g.trial}
            </text>
            <text className="v-cap" x={x0 + 39} y="192" textAnchor="middle">
              {g.drug}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
