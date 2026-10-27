import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { deck, slideById, type Slide as SlideData } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";
import { Slide } from "./Slide.js";
import { StayHere } from "./StayHere.js";

/** The slide stage with a ≤ 180 ms crossfade (arch §4.10); motion is off for reduced motion. */
export function Stage() {
  const { view } = useSession();
  const reduce = useReducedMotion();
  const slide = slideById(view.displayedSlide);
  return (
    <section className="stage" aria-label="Slides">
      <AnimatePresence initial={false}>
        <motion.div
          key={slide.id}
          className="slide-layer"
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.16, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <Layer slide={slide} index={view.slideIndex} highlight={view.highlightBullet} />
        </motion.div>
      </AnimatePresence>
      <StayHere />
    </section>
  );
}

/** The outgoing slide is hidden from assistive tech and tests while it fades out. */
function Layer({
  slide,
  index,
  highlight,
}: {
  slide: SlideData;
  index: number;
  highlight: number | null;
}) {
  const present = useIsPresent();
  return (
    <div aria-hidden={present ? undefined : true} className="layer-fill">
      <Slide
        slide={slide}
        index={index}
        total={deck.length}
        highlight={highlight}
        exiting={!present}
      />
    </div>
  );
}
