/** Decorative gut → pancreas / brain line drawing for the cover; draws itself on load. */
export function CoverMotif() {
  return (
    <svg className="motif" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
      <path className="m-line" pathLength={1} d="M58 130 C 130 130, 160 52, 252 48" />
      <path className="m-line" pathLength={1} d="M58 130 C 140 140, 190 140, 252 132" />
      <circle className="m-node" cx="40" cy="130" r="18" />
      <circle className="m-node" cx="268" cy="48" r="18" />
      <circle className="m-node" cx="268" cy="132" r="18" />
      <text className="m-lab" x="40" y="166" textAnchor="middle">
        gut
      </text>
      <text className="m-lab" x="268" y="84" textAnchor="middle">
        pancreas
      </text>
      <text className="m-lab" x="268" y="168" textAnchor="middle">
        brain
      </text>
    </svg>
  );
}
