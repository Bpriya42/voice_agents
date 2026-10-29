import type { PersonaId } from "@ava/shared";
import { meterValue } from "../../audio/micLevel.js";
import {
  VoiceError,
  newItemId,
  type ResponseRequest,
  type ToolName,
  type VoiceEvent,
  type VoiceEventBody,
  type VoiceSession,
} from "../types.js";
import {
  BENIGN_ERROR_CODES,
  CALLS_URL,
  CLIENT,
  COMMIT_EMPTY_CODE,
  DATA_CHANNEL,
  SERVER,
} from "./events.js";
import type { OutputGate } from "./outputGate.js";

export interface RealtimeDeps {
  api: {
    /** Throws VoiceError with the server's stable code on failure. */
    startSession(opts: { reconnectOf?: string; persona?: PersonaId }): Promise<{
      clientSecret: string;
      sessionId: string;
      expiresAt: number | null;
    }>;
    reportCall(sessionId: string, callId: string): Promise<void>;
  };
  fetch: typeof fetch;
  createPeerConnection: () => RTCPeerConnection;
  createGate: (stream: MediaStream) => OutputGate;
  hosted: boolean;
  /** ?debug=1 logging. Never receives audio, SDP or the client secret. */
  debug?: (msg: string, data?: Record<string, unknown>) => void;
}

const INTERRUPT_TIMEOUT_MS = 1500;
const COMMIT_TIMEOUT_MS = 1500;
const MIC_TAIL_MS = 150;
const PLAYBACK_TAIL_MS = 100;
const PEER_DISCONNECT_MS = 3000;

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

function waitForOpen(dc: RTCDataChannel, signal?: AbortSignal): Promise<void> {
  if (dc.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const prevOpen = dc.onopen;
    dc.onopen = (ev) => {
      dc.onopen = prevOpen;
      resolve();
      prevOpen?.call(dc, ev);
    };
    signal?.addEventListener("abort", () => reject(new VoiceError("session_failed")), {
      once: true,
    });
  });
}

/**
 * OpenAI Realtime over WebRTC (arch §3.2, §4.2). It executes the controller's commands and turns
 * provider events into VoiceEvents; it never decides what happens next.
 */
export class OpenAIRealtimeSession implements VoiceSession {
  sessionId: string | null = null;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private gate: OutputGate | null = null;
  private gain: 0 | 1 = 1;
  private sender: RTCRtpSender | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private closed = false;
  private listeners = new Set<(e: VoiceEvent) => void>();

  /** responseId → requestId, read back from response metadata. */
  private requestByResponse = new Map<string, string>();
  /** requestIds sent and not yet done (pending creation included). */
  private generating = new Set<string>();
  /** Requests and responses invalidated by interrupt(): their late audio is cleared on sight. */
  private cancelledRequests = new Set<string>();
  /** Responses with generated audio whose playback has not started yet, oldest first. */
  private audioPending: string[] = [];
  private started = new Set<string>();
  private playingResponseId: string | null = null;
  /** Provider buffer drained; waiting for the local playback tail to go silent. */
  private tailResponseId: string | null = null;

  private waiters = new Set<() => void>();
  private interrupting: Promise<"cleared" | "timeout"> | null = null;
  private turnId: string | null = null;
  private micTail: { id: ReturnType<typeof setTimeout>; reject: () => void } | null = null;
  private commitWaiter: ((itemId: string | null) => void) | null = null;
  private peerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly epoch: number,
    private deps: RealtimeDeps,
    private reconnectOf?: string,
    private persona?: PersonaId,
  ) {}

  async connect({ mic, signal }: { mic: MediaStream | null; signal?: AbortSignal }) {
    // The client secret stays in this local for the duration of connect() only.
    const { clientSecret, sessionId } = await this.deps.api.startSession({
      ...(this.persona ? { persona: this.persona } : {}),
      ...(this.reconnectOf ? { reconnectOf: this.reconnectOf } : {}),
    });
    if (this.closed) throw new VoiceError("session_failed");
    this.sessionId = sessionId;

    const pc = (this.pc = this.deps.createPeerConnection());
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream || this.gate) return;
      this.gate = this.deps.createGate(stream);
      this.gate.setGain(this.gain);
    };
    pc.onconnectionstatechange = () => this.onPeerState(pc.connectionState);

    const track = mic?.getAudioTracks()[0];
    if (mic && track) {
      track.enabled = false; // phase 1: enabled only while a turn is held
      this.micTrack = track;
      this.watchTrack(track);
      this.sender = pc.addTrack(track, mic);
    } else {
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    const dc = (this.dc = pc.createDataChannel(DATA_CHANNEL));
    dc.onmessage = (m: MessageEvent) => {
      let ev: unknown;
      try {
        ev = JSON.parse(String(m.data));
      } catch {
        return;
      }
      this.onServerEvent(obj(ev));
    };
    dc.onclose = () => {
      if (!this.closed) this.emit({ type: "disconnected", reason: "server" });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let res: Response;
    try {
      res = await this.deps.fetch(CALLS_URL, {
        method: "POST",
        body: offer.sdp ?? "",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new VoiceError("session_failed");
    }
    if (!res.ok) throw new VoiceError(res.status === 429 ? "rate_limited" : "session_failed");
    if (this.closed) throw new VoiceError("session_failed");
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });

    const callId = res.headers.get("Location")?.split("/").pop();
    if (this.deps.hosted && callId) {
      void this.deps.api.reportCall(sessionId, callId).catch(() => {});
    }
    await waitForOpen(dc, signal);
    if (this.closed) throw new VoiceError("session_failed");
    this.emit({ type: "connected" });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancelMicTail();
    if (this.peerTimer) clearTimeout(this.peerTimer);
    this.commitWaiter?.(null);
    this.commitWaiter = null;
    // A closed transport counts as cleared (arch §4.2).
    for (const w of [...this.waiters]) w();
    this.waiters.clear();
    if (this.micTrack) this.micTrack.enabled = false;
    this.gate?.close();
    try {
      this.dc?.close();
    } catch {
      /* already closed */
    }
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.listeners.clear();
  }

  on(listener: (e: VoiceEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  createResponse(req: ResponseRequest) {
    this.generating.add(req.requestId);
    this.send({
      type: CLIENT.responseCreate,
      response: {
        // Out of band and with an empty context: narration never reacts to earlier turns.
        ...(req.outOfBand ? { conversation: "none", input: [] } : {}),
        instructions: req.instructions,
        tool_choice: req.toolChoice,
        metadata: {
          requestId: req.requestId,
          epoch: String(this.epoch),
          turnId: req.turnId ?? "",
          kind: req.kind,
        },
      },
    });
  }

  sendUserText(text: string) {
    const id = newItemId("user");
    this.send({
      type: CLIENT.itemCreate,
      item: { id, type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    return id;
  }

  sendToolResult(callId: string, output: unknown) {
    const id = newItemId("out");
    this.send({
      type: CLIENT.itemCreate,
      item: { id, type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    });
    return id;
  }

  /** Mute at once; resolve when generation has ended and playback is cleared, or after 1.5 s. */
  interrupt(): Promise<"cleared" | "timeout"> {
    this.setOutputGain(0);
    if (this.interrupting) return this.interrupting;
    for (const q of this.generating) this.cancelledRequests.add(q);
    if (this.tailResponseId) {
      // Already drained at the provider; the local tail is muted, so it ends here.
      const rid = this.tailResponseId;
      this.tailResponseId = null;
      this.emit({ type: "playback_cleared", responseId: rid });
    }
    const needCancel = this.generating.size > 0;
    const needClear = this.playingResponseId !== null;
    // Out-of-band responses (narration, greeting) are only cancelled by response_id; a bare
    // cancel gets response_cancel_not_active (spike S). A bare cancel still covers an in-band
    // request whose response.created has not arrived; out-of-band ones are cancelled on creation.
    let bare = false;
    for (const q of this.generating) {
      const rid = this.responseOf(q);
      if (rid) this.send({ type: CLIENT.responseCancel, response_id: rid });
      else bare = true;
    }
    if (bare) this.send({ type: CLIENT.responseCancel });
    if (needClear) this.send({ type: CLIENT.audioClear });
    if (!needCancel && !needClear) return Promise.resolve("cleared");
    const p = this.waitFor(
      () => this.generating.size === 0 && this.playingResponseId === null,
      INTERRUPT_TIMEOUT_MS,
    );
    this.interrupting = p;
    void p.finally(() => {
      if (this.interrupting === p) this.interrupting = null;
    });
    return p;
  }

  beginUserTurn(turnId: string) {
    this.turnId = turnId;
    this.cancelMicTail();
    void this.interrupt();
    this.send({ type: CLIENT.inputClear });
    this.setMicEnabled(true);
  }

  async endUserTurn({ cancel }: { cancel: boolean }) {
    if (cancel) {
      this.cancelMicTail();
      this.setMicEnabled(false);
      this.send({ type: CLIENT.inputClear });
      this.commitWaiter?.(null);
      return { committed: false };
    }
    try {
      await this.tail(MIC_TAIL_MS); // cancellable: close() or a new turn rejects it
    } catch {
      return { committed: false };
    }
    this.setMicEnabled(false);
    this.send({ type: CLIENT.inputCommit });
    const itemId = await this.waitForCommit(COMMIT_TIMEOUT_MS);
    return itemId ? { committed: true, itemId } : { committed: false };
  }

  addControllerNote(text: string) {
    const id = newItemId("note");
    this.send({
      type: CLIENT.itemCreate,
      item: { id, type: "message", role: "system", content: [{ type: "input_text", text }] },
    });
    return Promise.resolve(id);
  }

  addAssistantText(text: string) {
    this.send({
      type: CLIENT.itemCreate,
      item: {
        id: newItemId("replay"),
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    });
  }

  deleteItems(ids: string[]) {
    for (const id of ids) this.send({ type: CLIENT.itemDelete, item_id: id });
  }

  setMicEnabled(enabled: boolean) {
    if (this.micTrack) this.micTrack.enabled = enabled;
  }

  setTurnMode(mode: "tapToTalk" | "handsFree") {
    this.send({
      type: CLIENT.sessionUpdate,
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection:
              mode === "handsFree"
                ? { type: "semantic_vad", interrupt_response: true, create_response: false }
                : null,
          },
        },
      },
    });
  }

  async replaceMic(track: MediaStreamTrack) {
    if (!this.sender) throw new VoiceError("no_sender");
    const old = this.micTrack;
    await this.sender.replaceTrack(track);
    track.enabled = old?.enabled ?? false;
    old?.stop();
    this.micTrack = track;
    this.watchTrack(track);
  }

  setOutputGain(gain: 0 | 1) {
    this.gain = gain;
    this.gate?.setGain(gain);
  }

  outputLevel() {
    return this.gate ? meterValue(this.gate.level()) : 0;
  }

  // ---- internals ----

  private send(ev: Json) {
    if (this.closed || !this.dc || this.dc.readyState !== "open") {
      this.deps.debug?.("send_dropped", { type: ev["type"] });
      return;
    }
    this.dc.send(JSON.stringify(ev));
  }

  private emit(body: VoiceEventBody) {
    if (this.closed) return;
    const e = { ...body, sessionEpoch: this.epoch } as VoiceEvent;
    for (const l of [...this.listeners]) l(e);
  }

  private watchTrack(track: MediaStreamTrack) {
    track.addEventListener?.("ended", () => {
      if (track === this.micTrack) this.emit({ type: "mic_ended" });
    });
  }

  private onPeerState(state: RTCPeerConnectionState) {
    if (this.closed) return;
    if (state === "connected" && this.peerTimer) {
      clearTimeout(this.peerTimer);
      this.peerTimer = null;
    } else if (state === "disconnected" && !this.peerTimer) {
      this.peerTimer = setTimeout(() => {
        this.peerTimer = null;
        this.emit({ type: "disconnected", reason: "network" });
      }, PEER_DISCONNECT_MS);
    } else if (state === "failed") {
      this.emit({ type: "disconnected", reason: "network" });
    }
  }

  private waitFor(cond: () => boolean, ms: number): Promise<"cleared" | "timeout"> {
    if (cond()) return Promise.resolve("cleared");
    return new Promise((resolve) => {
      const check = () => {
        if (!this.closed && !cond()) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve("cleared");
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        resolve("timeout");
      }, ms);
      this.waiters.add(check);
    });
  }

  private checkWaiters() {
    for (const w of [...this.waiters]) w();
  }

  private tail(ms: number): Promise<void> {
    this.cancelMicTail();
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => {
        this.micTail = null;
        resolve();
      }, ms);
      this.micTail = { id, reject: () => reject(new Error("tail_cancelled")) };
    });
  }

  private cancelMicTail() {
    if (!this.micTail) return;
    clearTimeout(this.micTail.id);
    const { reject } = this.micTail;
    this.micTail = null;
    reject();
  }

  private waitForCommit(ms: number): Promise<string | null> {
    this.commitWaiter?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), ms);
      const done = (itemId: string | null) => {
        clearTimeout(timer);
        if (this.commitWaiter === done) this.commitWaiter = null;
        resolve(itemId);
      };
      this.commitWaiter = done;
    });
  }

  private requestOf(responseId: string): string | undefined {
    return this.requestByResponse.get(responseId);
  }

  private responseOf(requestId: string): string | undefined {
    for (const [rid, q] of this.requestByResponse) if (q === requestId) return rid;
    return undefined;
  }

  private isCancelled(responseId: string) {
    const q = this.requestOf(responseId);
    return q !== undefined && this.cancelledRequests.has(q);
  }

  private markAudio(responseId: string) {
    if (!this.started.has(responseId) && !this.audioPending.includes(responseId)) {
      this.audioPending.push(responseId);
    }
  }

  private onServerEvent(ev: Json) {
    const type = str(ev["type"]);
    switch (type) {
      case SERVER.responseCreated: {
        const resp = obj(ev["response"]);
        const rid = str(resp["id"]);
        const requestId = str(obj(resp["metadata"])["requestId"]);
        if (!rid || !requestId) return this.deps.debug?.("untracked_response", { rid });
        this.requestByResponse.set(rid, requestId);
        // Interrupted before it was created: cancel it by id now (spike S: needed for out-of-band).
        if (this.cancelledRequests.has(requestId)) {
          this.send({ type: CLIENT.responseCancel, response_id: rid });
        }
        return this.emit({ type: "generation_started", requestId, responseId: rid });
      }
      case SERVER.responseDone: {
        const resp = obj(ev["response"]);
        const rid = str(resp["id"]);
        if (!rid) return;
        const requestId = this.requestOf(rid) ?? str(obj(resp["metadata"])["requestId"]);
        if (!requestId) return this.deps.debug?.("untracked_response_done", { rid });
        this.generating.delete(requestId);
        const output = Array.isArray(resp["output"]) ? resp["output"].map(obj) : [];
        const audioOut = output.some(
          (o) =>
            o["type"] === "message" &&
            Array.isArray(o["content"]) &&
            o["content"].some((c) => {
              const t = obj(c)["type"];
              return t === "output_audio" || t === "audio";
            }),
        );
        const hadAudio = audioOut || this.started.has(rid) || this.audioPending.includes(rid);
        if (hadAudio) this.markAudio(rid);
        const status = str(resp["status"]);
        const usage = obj(resp["usage"]);
        this.emit({
          type: "generation_done",
          requestId,
          responseId: rid,
          status:
            status === "cancelled" || status === "failed" || status === "incomplete"
              ? status
              : "completed",
          hadAudio,
          outputItemIds: output.map((o) => str(o["id"])).filter((x): x is string => !!x),
          ...(typeof usage["total_tokens"] === "number"
            ? {
                usage: {
                  totalTokens: usage["total_tokens"],
                  ...(typeof usage["input_tokens"] === "number"
                    ? { inputTokens: usage["input_tokens"] }
                    : {}),
                  ...(typeof usage["output_tokens"] === "number"
                    ? { outputTokens: usage["output_tokens"] }
                    : {}),
                },
              }
            : {}),
        });
        return this.checkWaiters();
      }
      case SERVER.audioStarted: {
        // If the provider omits response_id, attribute to the oldest response with unplayed audio,
        // never to the newest generation (arch §4.2).
        const rid = str(ev["response_id"]) ?? this.audioPending[0];
        if (!rid) return this.deps.debug?.("unattributed_playback");
        this.audioPending = this.audioPending.filter((x) => x !== rid);
        this.started.add(rid);
        this.playingResponseId = rid;
        if (this.isCancelled(rid)) this.send({ type: CLIENT.audioClear });
        return this.emit({ type: "playback_started", responseId: rid });
      }
      case SERVER.audioStopped: {
        const rid = str(ev["response_id"]) ?? this.playingResponseId;
        if (!rid || rid !== this.playingResponseId) return;
        this.playingResponseId = null;
        this.tailResponseId = rid;
        this.checkWaiters();
        const finish = () => {
          if (this.closed || this.tailResponseId !== rid) return;
          this.tailResponseId = null;
          this.emit({ type: "playback_completed", responseId: rid });
        };
        // Completion only after the local post-gate output reads silence (the playback tail).
        if (this.gate) void this.gate.whenSilent(PLAYBACK_TAIL_MS).then(finish);
        else finish();
        return;
      }
      case SERVER.audioCleared: {
        const rid = str(ev["response_id"]) ?? this.playingResponseId;
        if (!rid) return this.checkWaiters();
        if (rid === this.playingResponseId) this.playingResponseId = null;
        this.audioPending = this.audioPending.filter((x) => x !== rid);
        this.emit({ type: "playback_cleared", responseId: rid });
        return this.checkWaiters();
      }
      case SERVER.transcriptDelta: {
        const rid = str(ev["response_id"]);
        if (!rid) return;
        this.markAudio(rid);
        return this.emit({
          type: "agent_transcript",
          responseId: rid,
          delta: str(ev["delta"]) ?? "",
          final: false,
        });
      }
      case SERVER.transcriptDone: {
        const rid = str(ev["response_id"]);
        if (!rid) return;
        return this.emit({ type: "agent_transcript", responseId: rid, delta: "", final: true });
      }
      case SERVER.inputTranscriptDelta: {
        const itemId = str(ev["item_id"]);
        if (!itemId) return;
        return this.emit({
          type: "user_transcript",
          itemId,
          text: str(ev["delta"]) ?? "",
          final: false,
        });
      }
      case SERVER.inputTranscriptDone: {
        const itemId = str(ev["item_id"]);
        if (!itemId) return;
        return this.emit({
          type: "user_transcript",
          itemId,
          text: str(ev["transcript"]) ?? "",
          final: true,
        });
      }
      case SERVER.inputCommitted: {
        const itemId = str(ev["item_id"]);
        if (!itemId) return;
        this.commitWaiter?.(itemId);
        return this.emit({ type: "user_input_committed", turnId: this.turnId ?? "", itemId });
      }
      case SERVER.speechStarted:
        return this.emit({ type: "user_speech_started" });
      case SERVER.speechStopped:
        return this.emit({ type: "user_speech_stopped" });
      case SERVER.toolArgsDone: {
        const rid = str(ev["response_id"]);
        const callId = str(ev["call_id"]);
        const name = str(ev["name"]);
        if (!rid || !callId || !name) return;
        const requestId = this.requestOf(rid);
        if (!requestId) return this.deps.debug?.("untracked_tool_call", { name });
        let args: unknown = ev["arguments"];
        try {
          args = JSON.parse(String(ev["arguments"] ?? "{}"));
        } catch {
          /* left as the raw string; the controller's validation rejects it */
        }
        return this.emit({
          type: "tool_call",
          requestId,
          responseId: rid,
          callId,
          name: name as ToolName,
          args,
        });
      }
      case SERVER.error: {
        const err = obj(ev["error"]);
        const code = str(err["code"]) ?? "";
        if (code === COMMIT_EMPTY_CODE) this.commitWaiter?.(null);
        if (BENIGN_ERROR_CODES.has(code)) return this.deps.debug?.("benign_error", { code });
        return this.emit({
          type: "error",
          code: code.startsWith("rate_limit") ? "rate_limited" : "server_error",
          message: str(err["message"]) ?? "",
          fatal: false,
        });
      }
      default:
        if (type) this.deps.debug?.("ignored_event", { type });
    }
  }
}
