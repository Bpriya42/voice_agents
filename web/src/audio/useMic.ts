import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioContext } from "./context.js";
import {
  createSpeechDetector,
  meterValue,
  micErrorCode,
  rms,
  type MicErrorCode,
} from "./micLevel.js";

export type MicStatus = "idle" | "requesting" | "live" | "error";

export interface MicState {
  status: MicStatus;
  error: MicErrorCode | null;
  /** 0..1 meter value. */
  level: number;
  heard: boolean;
  /** No speech within SILENCE_MS of the stream starting (mic_silent). */
  silent: boolean;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
}

const SILENCE_MS = 6000;

const initial: MicState = {
  status: "idle",
  error: null,
  level: 0,
  heard: false,
  silent: false,
  devices: [],
  deviceId: null,
};

/**
 * One getUserMedia stream shared by the mic check and the session, so permission is asked once
 * (arch §4.8). The analyser loop drives the meter and the speech detector.
 */
export function useMic() {
  const [state, setState] = useState<MicState>(initial);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoop = useRef<() => void>(() => {});

  const listDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setState((s) => ({ ...s, devices: all.filter((d) => d.kind === "audioinput") }));
  }, []);

  const startLoop = useCallback((stream: MediaStream) => {
    stopLoop.current();
    const ctx = getAudioContext();
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const detect = createSpeechDetector();
    const started = performance.now();
    let heard = false;
    let raf = 0;
    let lastPush = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const level = rms(buf);
      const now = performance.now();
      if (!heard && detect(level, now)) heard = true;
      const silent = !heard && now - started > SILENCE_MS;
      // ~30 updates per second is plenty for a meter.
      if (now - lastPush > 33) {
        lastPush = now;
        setState((s) =>
          s.level === meterValue(level) && s.heard === heard && s.silent === silent
            ? s
            : { ...s, level: meterValue(level), heard, silent },
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stopLoop.current = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
    };
  }, []);

  const release = useCallback(() => {
    stopLoop.current();
    stopLoop.current = () => {};
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => ({ ...initial, devices: s.devices }));
  }, []);

  const request = useCallback(
    async (deviceId?: string) => {
      stopLoop.current();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setState((s) => ({ ...s, status: "requesting", error: null, heard: false, silent: false }));
      if (!navigator.mediaDevices?.getUserMedia) {
        setState((s) => ({ ...s, status: "error", error: "mic_not_found" }));
        return null;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        });
        streamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        setState((s) => ({
          ...s,
          status: "live",
          deviceId: track?.getSettings().deviceId ?? deviceId ?? null,
        }));
        startLoop(stream);
        await listDevices();
        return stream;
      } catch (e) {
        setState((s) => ({ ...s, status: "error", error: micErrorCode(e) }));
        return null;
      }
    },
    [listDevices, startLoop],
  );

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void listDevices();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [listDevices]);

  useEffect(() => () => stopLoop.current(), []);

  return {
    state,
    stream: () => streamRef.current,
    request,
    selectDevice: (id: string) => request(id),
    release,
  };
}

export type MicControls = ReturnType<typeof useMic>;
