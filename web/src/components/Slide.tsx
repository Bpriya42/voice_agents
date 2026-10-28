import type { Slide as SlideData } from "@ava/shared";
import { VISUALS } from "../slides/visuals/index.js";

interface Props {
  slide: SlideData;
  index: number;
  total: number;
  /** The narrated sentence's bullet, or null when nothing is being narrated on this slide. */
  highlight: number | null;
  exiting?: boolean;
}

/** One slide: title, bullets, diagram, sources and the medical disclaimer (brief §5). */
export function Slide({ slide, index, total, highlight, exiting = false }: Props) {
  const Visual = VISUALS[slide.visual];
  return (
    <article
      className={`slide ${highlight !== null ? "hl" : ""}`}
      aria-label={`Slide ${index + 1} of ${total}`}
    >
      <div className="slide-inner">
        <div className="slide-text">
          <p className="kicker">
            {index + 1} / {total}
          </p>
          <h2 data-testid={exiting ? undefined : "slide-title"}>{slide.title}</h2>
          <ul className="bul">
            {slide.bullets.map((b, i) => (
              <li
                key={b}
                className={highlight === i ? "on" : ""}
                aria-current={highlight === i ? "true" : undefined}
              >
                <span className="mk" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        </div>
        <figure className="s-vis">
          <Visual />
        </figure>
      </div>
      <footer className="s-foot">
        <span>
          Sources: {slide.sources.map((s) => s.label).join(" · ")}
          {slide.statusAsOf && <> · Status as of {slide.statusAsOf}</>}
        </span>
        <span>Educational demo — not medical advice.</span>
      </footer>
    </article>
  );
}
