import { slideById } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/**
 * Readable sentence scripts for when nothing can be spoken (backup voice without speech, offline
 * with no local voice). Navigation and typed questions keep working (arch §6.4–6.5).
 */
export function ScriptPanel() {
  const { view } = useSession();
  if (!view.scriptMode) return null;
  const slide = slideById(view.displayedSlide);
  return (
    <section className="script" data-testid="script" aria-label="Slide script">
      <h2>Script: {slide.title}</h2>
      <ol>
        {slide.segments.map((seg, i) => (
          <li
            key={seg.text}
            aria-current={
              view.checkpoint.slideId === slide.id && view.checkpoint.sentenceIndex === i
                ? "true"
                : undefined
            }
          >
            {seg.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
