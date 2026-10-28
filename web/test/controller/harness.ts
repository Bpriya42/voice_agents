import { vi } from "vitest";
import type { ApiResult, ChatAnswer, ChatInput } from "../../src/api/client.js";
import { createController } from "../../src/presentation/controller.js";
import { FakeVoiceSession } from "../../src/voice/fake/FakeVoiceSession.js";
import { FallbackSpeechSession } from "../../src/voice/fallback/FallbackSpeechSession.js";
import type { ResponseRequest } from "../../src/voice/types.js";
import { FakeSpeech, makeUtterance } from "../voice/fakeSpeech.js";

export interface SetupOptions {
  /** The first N live connects fail (initial, retries and probes all count). */
  failConnects?: number;
  /** Provide the backup / offline voice factory. */
  backup?: boolean;
  /** `null` simulates a browser with no speech engine. */
  speech?: FakeSpeech | null;
  probe?: () => Promise<boolean>;
  chat?: (input: ChatInput) => Promise<ApiResult<ChatAnswer>>;
}

/** Controller + FakeVoiceSession with fake timers (implementation.md M6, M8). */
export function setup(opts: SetupOptions = {}) {
  vi.useFakeTimers();
  const voices: FakeVoiceSession[] = [];
  const fallbacks: FallbackSpeechSession[] = [];
  const factoryOpts: ({ reconnectOf?: string } | undefined)[] = [];
  const ended: string[] = [];
  const fails = { left: opts.failConnects ?? 0 };
  const speech = opts.speech === undefined ? new FakeSpeech() : opts.speech;
  const chats: ChatInput[] = [];
  const chat =
    opts.chat ??
    (async (input: ChatInput): Promise<ApiResult<ChatAnswer>> => {
      chats.push(input);
      return { ok: true, data: { answer: "Backup answer." } };
    });

  const ctl = createController({
    voiceFactory: (epoch, o) => {
      const v = new FakeVoiceSession({ epoch, failConnect: fails.left-- > 0 });
      voices.push(v);
      factoryOpts.push(o);
      return v;
    },
    ...(opts.backup
      ? {
          backupFactory: (epoch, mode, context) => {
            const f = new FallbackSpeechSession(epoch, {
              mode,
              speech,
              makeUtterance,
              ...(mode === "backup" ? { chat } : {}),
              context,
            });
            fallbacks.push(f);
            return f;
          },
        }
      : {}),
    ...(opts.probe ? { probeHealth: opts.probe } : {}),
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    onEndSession: (id) => ended.push(id),
  });
  const voice = () => voices.at(-1)!;
  const creates = () => voice().creates();
  const last = (): ResponseRequest => creates().at(-1)!;
  /** Settle promise chains without firing pending timers. */
  const flush = () => vi.advanceTimersByTimeAsync(0);

  /** Play a request through generation and playback. */
  const play = (requestId: string, text?: string) => {
    const v = voice();
    v.generationStarted(requestId);
    v.playbackStarted(requestId);
    if (text) v.agentSays(requestId, text);
    v.generationDone(requestId, "completed", { hadAudio: true });
    v.playbackCompleted(requestId);
  };

  /** Started and playing, not finished. */
  const startPlaying = (requestId: string) => {
    voice().generationStarted(requestId);
    voice().playbackStarted(requestId);
  };

  /** A fake mic: voice input mode. Tracks record stop(). */
  const tracks: { enabled: boolean; stopped: boolean; stop(): void }[] = [];
  const mic = () => {
    const track = {
      enabled: true,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  };

  /** Start with a mic, then play the greeting through so sentence 0 of slide 1 is requested. */
  const started = async ({ withMic = true } = {}) => {
    await ctl.start(withMic ? mic() : null);
    play(last().requestId);
  };

  /** Ask a typed question and get to the point where the answer request has been sent. */
  const typed = async (q: string) => {
    await ctl.askTyped(q);
    voice().ackInterrupt();
    await flush();
    return last();
  };

  /** Hold Space for `ms`, release, commit the turn and get the answer request. */
  const spoken = async (holdMs = 600, itemId = "item_user_1") => {
    ctl.talkDown();
    voice().ackInterrupt();
    vi.advanceTimersByTime(holdMs);
    ctl.talkUp();
    await flush();
    voice().userCommitted(itemId);
    await flush();
    return last();
  };

  const kinds = () => creates().map((c) => c.kind);
  const view = () => ctl.view();

  return {
    ctl,
    mic,
    tracks,
    voice,
    voices,
    fallbacks,
    factoryOpts,
    fails,
    speech,
    chats,
    creates,
    last,
    play,
    startPlaying,
    started,
    typed,
    spoken,
    flush,
    kinds,
    view,
    ended,
  };
}
