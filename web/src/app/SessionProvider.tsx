import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { PersonaId } from "@ava/shared";
import { createApiClient, type ApiClient, type ApiCode, type HealthInfo } from "../api/client.js";
import { getAudioContext } from "../audio/context.js";
import { useMic, type MicControls } from "../audio/useMic.js";
import { DebugOverlay } from "../components/DebugOverlay.js";
import { useShortcuts } from "../input/useShortcuts.js";
import { HealthProbe, watchConnectivity } from "../net/probe.js";
import {
  createController,
  type ControllerView,
  type PresentationController,
} from "../presentation/controller.js";
import { FakeVoiceSession } from "../voice/fake/FakeVoiceSession.js";
import {
  FallbackSpeechSession,
  type FallbackContext,
} from "../voice/fallback/FallbackSpeechSession.js";
import { OpenAIRealtimeSession } from "../voice/openai/OpenAIRealtimeSession.js";
import { createOutputGate } from "../voice/openai/outputGate.js";
import { VoiceError, type VoiceErrorCode, type VoiceSession } from "../voice/types.js";
import { readStoredPresenter, writeStoredPresenter } from "./presenter.js";
import { localStore } from "./theme.js";

/** VITE_E2E is set only by `vite --mode e2e`; production builds drop the fake branch entirely. */
const isE2E = import.meta.env.VITE_E2E === "1";

interface Session {
  controller: PresentationController;
  view: ControllerView;
  mic: MicControls;
  health: HealthInfo | null;
  healthError: ApiCode | null;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  askRef: RefObject<HTMLInputElement>;
  /** "Try microphone again" and the device picker in text mode. */
  tryMic: () => Promise<void>;
  pickMic: (deviceId: string) => Promise<void>;
  /** Landing page presenter picker: sets the controller's presenter and remembers it. */
  choosePersona: (persona: PersonaId) => void;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

const API_TO_VOICE: Partial<Record<ApiCode, VoiceErrorCode>> = {
  not_configured: "not_configured",
  quota: "quota",
  demo_paused: "demo_paused",
  demo_busy: "demo_busy",
  quota_reached: "quota_reached",
  rate_limited: "rate_limited",
  bot_check_failed: "bot_check_failed",
  backend_unreachable: "backend_unreachable",
  server_error: "server_error",
};

function voiceFactory(
  api: ApiClient,
  hosted: () => boolean,
  debug?: (m: string, d?: object) => void,
) {
  const params = new URLSearchParams(window.location.search);
  if (isE2E && params.get("fake") === "1") {
    // ?fakeFailConnect=N makes the first N connects fail; ?fakeConnectDelayMs=N slows every connect.
    let failsLeft = Number(params.get("fakeFailConnect")) || 0;
    const connectDelayMs = Number(params.get("fakeConnectDelayMs")) || 0;
    return (epoch: number, opts: { persona: PersonaId }): VoiceSession => {
      // ?fakeMsPerChar=N slows the fake's speech for tests that must act mid-answer.
      const msPerChar = Number(params.get("fakeMsPerChar")) || undefined;
      const failConnect = failsLeft > 0;
      if (failConnect) failsLeft--;
      const v = new FakeVoiceSession({
        epoch,
        auto: true,
        failConnect,
        connectDelayMs,
        persona: opts.persona,
        ...(msPerChar ? { msPerChar } : {}),
      });
      // Test hook for Playwright: output gain, mic state, scripted transcripts.
      (window as unknown as { __avaFake: FakeVoiceSession }).__avaFake = v;
      return v;
    };
  }
  return (epoch: number, opts: { reconnectOf?: string; persona: PersonaId }): VoiceSession =>
    new OpenAIRealtimeSession(
      epoch,
      {
        api: {
          async startSession(opts) {
            const r = await api.startSession(opts);
            if (!r.ok) throw new VoiceError(API_TO_VOICE[r.code] ?? "session_failed");
            return r.data;
          },
          async reportCall(sessionId, callId) {
            await api.reportCall(sessionId, callId);
          },
        },
        fetch: (...a) => fetch(...a),
        createPeerConnection: () => new RTCPeerConnection(),
        createGate: (stream) => createOutputGate(stream, getAudioContext()),
        hosted: hosted(),
        ...(debug ? { debug } : {}),
      },
      opts.reconnectOf,
      opts.persona,
    );
}

/** Backup voice and offline narration run on the browser's speech engine (arch §6.4–6.5). */
function backupFactory(api: ApiClient) {
  return (epoch: number, mode: "backup" | "local", context: FallbackContext): VoiceSession =>
    new FallbackSpeechSession(epoch, {
      mode,
      speech: "speechSynthesis" in window ? window.speechSynthesis : null,
      makeUtterance: (text) => new SpeechSynthesisUtterance(text),
      ...(mode === "backup" ? { chat: (input) => api.chat(input) } : {}),
      context,
    });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => createApiClient(), []);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<ApiCode | null>(null);
  const healthRef = useRef<HealthInfo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const askRef = useRef<HTMLInputElement>(null);
  const mic = useMic();

  const [debugOn] = useState(
    () => new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const [controller] = useState(() => {
    // ?debug=1 only: event types and ids, never audio, SDP, transcripts or secrets.
    const debug = debugOn
      ? (m: string, d?: object) => console.debug("[ava]", m, d ?? "")
      : undefined;
    return createController({
      voiceFactory: voiceFactory(
        api,
        () => healthRef.current?.limits.sessionMaxMinutes != null,
        debug,
      ),
      backupFactory: backupFactory(api),
      persona: readStoredPresenter(localStore()),
      probeHealth: new HealthProbe().check,
      onEndSession: (id) => api.endSession(id),
      // Anonymous p50/p90 per metric, hosted builds only (arch §7).
      onMetrics: (id, metrics) => {
        if (healthRef.current?.limits.sessionMaxMinutes != null) api.sendMetrics(id, metrics);
      },
      ...(debug ? { debug } : {}),
    });
  });
  const view = useSyncExternalStore(controller.subscribe, controller.view);

  useEffect(() => {
    let live = true;
    void api.getHealth().then((r) => {
      if (!live) return;
      if (r.ok) {
        healthRef.current = r.data;
        setHealth(r.data);
      } else setHealthError(r.code);
    });
    return () => {
      live = false;
    };
  }, [api]);

  // online / offline are hints; the controller confirms them with a timed probe (arch §6.5).
  useEffect(
    () => watchConnectivity(window, (online) => controller.networkHint(online)),
    [controller],
  );

  // pagehide frees the server slot at once (arch §3.1).
  useEffect(() => {
    const onHide = () => controller.end();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [controller]);

  useEffect(() => {
    if (!isE2E) return;
    (window as unknown as { __avaMic: () => MediaStream | null }).__avaMic = mic.stream;
  }, [mic.stream]);

  useShortcuts((a) => {
    const v = controller.view();
    if (a.action === "help") return setHelpOpen(!helpOpen);
    if (a.action === "escape" && helpOpen) return setHelpOpen(false);
    if (v.screen !== "live") return;
    switch (a.action) {
      case "talkDown":
        return controller.talkDown("space");
      case "talkUp":
        return controller.talkUp();
      case "focusLost":
        return controller.focusLost();
      case "pause":
        return controller.togglePause();
      case "prev":
        return controller.prev();
      case "next":
        return controller.next();
      case "goto":
        return controller.goto(a.slide ?? 0);
      case "focusAsk":
        return askRef.current?.focus();
      case "stay":
        return controller.stayHere();
      case "retry":
        if (v.controls.retry) return controller.retry();
        if (v.askAgain) return controller.askAgain();
        return;
      case "end":
        return controller.end();
      case "escape":
        return controller.escape();
      case "mute": // phase 2
        return;
    }
  });

  const useStream = async (stream: MediaStream | null) => {
    if (stream) await controller.useMicrophone(stream);
    else controller.micUnavailable();
  };
  const tryMic = async () => useStream(await mic.request());
  const pickMic = async (deviceId: string) => useStream(await mic.selectDevice(deviceId));
  const choosePersona = (persona: PersonaId) => {
    controller.setPersona(persona);
    writeStoredPresenter(localStore(), persona);
  };

  const value: Session = {
    controller,
    view,
    mic,
    health,
    healthError,
    helpOpen,
    setHelpOpen,
    askRef,
    tryMic,
    pickMic,
    choosePersona,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {debugOn && <DebugOverlay />}
    </Ctx.Provider>
  );
}
