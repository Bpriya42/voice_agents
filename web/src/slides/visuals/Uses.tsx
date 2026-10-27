/** US approval timeline (facts uses-1, uses-2, uses-3, uses-5, uses-6). */
const ROWS: [string, string, string][] = [
  ["2017", "Semaglutide (Ozempic)", "type 2 diabetes"],
  ["2021", "Semaglutide (Wegovy)", "weight management"],
  ["2022", "Tirzepatide (Mounjaro)", "type 2 diabetes"],
  ["2023", "Tirzepatide (Zepbound)", "weight management"],
  ["2024", "Semaglutide (Wegovy)", "cardiovascular risk"],
];

export function Uses() {
  return (
    <svg viewBox="0 0 320 178" role="img" aria-label="Timeline of US approvals from 2017 to 2024">
      <text className="v-cap" x="20" y="14">
        US approvals (FDA)
      </text>
      <line className="v-grid" x1="62" y1="30" x2="62" y2="164" />
      {ROWS.map(([year, drug, use], i) => {
        const y = 38 + i * 30;
        return (
          <g key={`${year}-${use}`}>
            <text className="v-val" x="20" y={y + 4}>
              {year}
            </text>
            <circle className="v-dot" cx="62" cy={y} r="4" />
            <text className="v-lab" x="76" y={y + 4}>
              {drug} <tspan className="v-cap">· {use}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
