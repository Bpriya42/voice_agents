/** Half-life to scale: native GLP-1 about 2 minutes, semaglutide about 7 days (facts intro-3, mech-6). */
export function Receptor() {
  const weekMinutes = 7 * 24 * 60;
  const full = 260;
  // 2 minutes on a 7-day axis is far below a pixel; keep a 1px sliver so it stays visible.
  const native = Math.max(1, (2 / weekMinutes) * full);
  return (
    <svg
      viewBox="0 0 320 172"
      role="img"
      aria-label="Half-life: natural GLP-1 about 2 minutes, semaglutide about 7 days"
    >
      <text className="v-cap" x="20" y="16">
        Half-life, linear scale
      </text>
      <text className="v-lab" x="20" y="48">
        Natural GLP-1
      </text>
      <rect className="v-bar" x="20" y="56" width={native} height="18" rx="1" />
      <text className="v-val" x="30" y="69">
        ≈ 2 minutes
      </text>
      <text className="v-lab" x="20" y="106">
        Semaglutide
      </text>
      <rect className="v-bar" x="20" y="114" width={full} height="18" rx="2" />
      <text className="v-in" x="272" y="127" textAnchor="end">
        ≈ 7 days
      </text>
      <line className="v-grid" x1="20" y1="150" x2="280" y2="150" />
      <text className="v-cap" x="20" y="164">
        0
      </text>
      <text className="v-cap" x="280" y="164" textAnchor="end">
        7 days
      </text>
    </svg>
  );
}
