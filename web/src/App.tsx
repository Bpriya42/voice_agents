import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SessionProvider, useSession } from "./app/SessionProvider.js";
import { dockQuiet, useIdle } from "./app/useIdle.js";
import { AskBox } from "./components/AskBox.js";
import { Captions } from "./components/Captions.js";
import { Controls } from "./components/Controls.js";
import { EndScreen } from "./components/EndScreen.js";
import { HelpDialog } from "./components/HelpDialog.js";
import { Landing } from "./components/Landing.js";
import { LiveHeader } from "./components/LiveHeader.js";
import { MicCheck } from "./components/MicCheck.js";
import { Notices } from "./components/Notices.js";
import { Splash } from "./components/Splash.js";
import { Stage } from "./components/Stage.js";
import { StatusOrb } from "./components/StatusOrb.js";
import { ThemeToggle } from "./components/ThemeToggle.js";

function Live() {
  const { view } = useSession();
  const idle = useIdle();
  const [dockFocused, setDockFocused] = useState(false);
  const attention =
    view.presentationStatus !== "running" ||
    view.askAgain ||
    Boolean(view.notice) ||
    Boolean(view.snapshot.error) ||
    view.snapshot.connection === "failed";
  const quiet = dockQuiet({ idle, focused: dockFocused, attention });

  return (
    <main className="live" data-quiet={quiet || undefined}>
      <h1 className="sr-only">Ava: how GLP-1 medicines work</h1>
      <div className="live-main">
        <LiveHeader />
        <div className="live-stage">
          <Stage />
        </div>
        <div
          className="dock"
          onFocus={() => setDockFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDockFocused(false);
          }}
        >
          <Controls />
        </div>
      </div>
      <aside className="rail" aria-label="Ava">
        <StatusOrb />
        <Notices />
        <Captions />
        <AskBox />
      </aside>
      <Splash />
    </main>
  );
}

function Screens() {
  const { view } = useSession();
  const reduce = useReducedMotion();
  const key = view.screen === "ready" ? "micCheck" : view.screen;
  let screen;
  switch (view.screen) {
    case "landing":
      screen = <Landing />;
      break;
    case "micCheck":
    case "ready":
      screen = <MicCheck />;
      break;
    case "ended":
      screen = <EndScreen />;
      break;
    case "live":
      screen = <Live />;
      break;
  }
  return (
    <motion.div
      key={key}
      className="screen"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {screen}
    </motion.div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Screens />
      <ThemeToggle />
      <HelpDialog />
    </SessionProvider>
  );
}
