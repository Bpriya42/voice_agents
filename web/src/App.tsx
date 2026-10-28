import { SessionProvider, useSession } from "./app/SessionProvider.js";
import { AskBox } from "./components/AskBox.js";
import { Captions } from "./components/Captions.js";
import { Controls } from "./components/Controls.js";
import { EndScreen } from "./components/EndScreen.js";
import { HelpDialog } from "./components/HelpDialog.js";
import { Landing } from "./components/Landing.js";
import { MicCheck } from "./components/MicCheck.js";
import { Notices } from "./components/Notices.js";
import { Stage } from "./components/Stage.js";
import { StatusOrb } from "./components/StatusOrb.js";

function Screens() {
  const { view } = useSession();
  switch (view.screen) {
    case "landing":
      return <Landing />;
    case "micCheck":
    case "ready":
      return <MicCheck />;
    case "ended":
      return <EndScreen />;
    case "live":
      return (
        <main className="app">
          <h1 className="sr-only">Ava: how GLP-1 medicines work</h1>
          <div className="stage-col">
            <Stage />
            <Controls />
          </div>
          <aside className="rail" aria-label="Ava">
            <StatusOrb />
            <Notices />
            <Captions />
            <AskBox />
          </aside>
        </main>
      );
  }
}

export function App() {
  return (
    <SessionProvider>
      <Screens />
      <HelpDialog />
    </SessionProvider>
  );
}
