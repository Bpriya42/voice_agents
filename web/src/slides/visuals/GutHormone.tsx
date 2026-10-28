/** GLP-1 from the gut to the pancreas and brain (facts intro-1, intro-2, intro-6). */
export function GutHormone() {
  return (
    <svg
      viewBox="0 0 320 214"
      role="img"
      aria-label="GLP-1 travels from the gut to the pancreas and the brain"
    >
      <path className="v-path" d="M90 150 C 150 150, 170 68, 226 62" />
      <path className="v-path" d="M90 150 C 150 160, 180 160, 226 158" />
      <circle className="v-node" cx="60" cy="150" r="30" />
      <text className="v-lab" x="60" y="154" textAnchor="middle">
        Gut
      </text>
      <circle className="v-node" cx="258" cy="60" r="32" />
      <text className="v-lab" x="258" y="64" textAnchor="middle">
        Pancreas
      </text>
      <circle className="v-node" cx="258" cy="158" r="32" />
      <text className="v-lab" x="258" y="162" textAnchor="middle">
        Brain
      </text>
      <text className="v-cap" x="60" y="200" textAnchor="middle">
        releases GLP-1 after a meal
      </text>
      <text className="v-cap" x="258" y="111" textAnchor="middle">
        insulin ↑ when glucose is high
      </text>
      <text className="v-cap" x="258" y="206" textAnchor="middle">
        fullness ↑
      </text>
    </svg>
  );
}
