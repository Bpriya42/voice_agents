import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** A brief title card as the talk opens. It never takes clicks, so the controls work underneath. */
export function Splash() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(!reduce);

  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => setShow(false), 1500);
    return () => window.clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="splash"
          aria-hidden="true"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeOut" } }}
        >
          <motion.p
            className="splash-kicker"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            A talk with
          </motion.p>
          <motion.p
            className="splash-mark"
            initial={{ opacity: 0, y: 14, letterSpacing: "0.12em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "-0.02em" }}
            transition={{ delay: 0.2, duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
          >
            Ava
          </motion.p>
          <motion.span
            className="splash-rule"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.45, duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
