import type { OutputGate } from "../../src/voice/openai/outputGate.js";

/** Records what the adapter sends; deliver() simulates server events. */
export class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  open() {
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
  deliver(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }
  types() {
    return this.sent.map((e) => e["type"]);
  }
}

export class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  tracks: MediaStreamTrack[] = [];
  transceivers: { kind: string; init?: RTCRtpTransceiverInit }[] = [];
  channel = new FakeDataChannel();
  remote: RTCSessionDescriptionInit | null = null;
  closed = false;
  replaced: MediaStreamTrack[] = [];
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
    return {
      replaceTrack: async (t: MediaStreamTrack) => void this.replaced.push(t),
    } as unknown as RTCRtpSender;
  }
  addTransceiver(kind: string, init?: RTCRtpTransceiverInit) {
    this.transceivers.push(init ? { kind, init } : { kind });
    return {} as RTCRtpTransceiver;
  }
  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 fake-offer" } as RTCSessionDescriptionInit;
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
    // The data channel opens once the answer is applied.
    queueMicrotask(() => this.channel.open());
  }
  close() {
    this.closed = true;
    this.channel.close();
  }
  fireTrack(stream: MediaStream) {
    this.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
  }
  setState(s: RTCPeerConnectionState) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}

/** A gate whose silence the test controls. */
export class FakeGate implements OutputGate {
  gains: (0 | 1)[] = [];
  closed = false;
  private silentWaiters: (() => void)[] = [];
  setGain(g: 0 | 1) {
    this.gains.push(g);
  }
  level() {
    return 0;
  }
  whenSilent() {
    return new Promise<void>((r) => this.silentWaiters.push(r));
  }
  /** The post-gate analyser reads silence. */
  silence() {
    const ws = this.silentWaiters;
    this.silentWaiters = [];
    ws.forEach((r) => r());
  }
  close() {
    this.closed = true;
  }
}

export function fakeTrack() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    enabled: true,
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    fire(type: string) {
      listeners[type]?.forEach((f) => f());
    },
  };
}

export function fakeMic(track = fakeTrack()) {
  return {
    track,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream,
  };
}
