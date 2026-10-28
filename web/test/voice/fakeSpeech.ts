import type { SpeechLike } from "../../src/voice/fallback/FallbackSpeechSession.js";

export interface FakeUtterance {
  text: string;
  lang: string;
  voice: { localService: boolean; name: string } | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** A stand-in for `speechSynthesis` that the test drives by hand. */
export class FakeSpeech implements SpeechLike {
  spoken: FakeUtterance[] = [];
  cancels = 0;
  voices: { localService: boolean; name: string }[];

  constructor(voices: { localService: boolean; name: string }[] = []) {
    this.voices = voices;
  }

  speak(u: SpeechSynthesisUtterance) {
    this.spoken.push(u as unknown as FakeUtterance);
  }

  cancel() {
    this.cancels++;
  }

  getVoices() {
    return this.voices as unknown as SpeechSynthesisVoice[];
  }

  last() {
    return this.spoken.at(-1)!;
  }

  /** The browser started speaking the most recent utterance. */
  start() {
    this.last().onstart?.();
  }

  /** The most recent utterance finished. */
  end() {
    this.last().onend?.();
  }

  fail() {
    this.last().onerror?.();
  }
}

export const makeUtterance = (text: string) =>
  ({
    text,
    lang: "",
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
  }) as unknown as SpeechSynthesisUtterance;
