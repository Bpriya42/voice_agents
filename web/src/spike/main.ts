// Day-1 spike (implementation.md §S). Logs every data-channel event with its type and ids only:
// never audio, SDP, transcripts or the client secret.
import { rms } from "../audio/micLevel.js";
import { CALLS_URL, CLIENT, DATA_CHANNEL, SERVER } from "../voice/openai/events.js";
import { createOutputGate, type OutputGate } from "../voice/openai/outputGate.js";
import { SPIKE_QUESTIONS, askOne } from "./questions.js";

type Ev = Record<string, unknown>;
interface Entry {
  t: number;
  dir: "in" | "out";
  type: string;
  ids: Record<string, string>;
  status?: string;
}

const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const log: Entry[] = [];
const results: Record<string, unknown> = {};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setStatus = (s: string) => ($("status").textContent = s);
const show = () => ($("summary").textContent = JSON.stringify(results, null, 2));

let pc: RTCPeerConnection | null = null;
let dc: RTCDataChannel | null = null;
let ctx: AudioContext | null = null;
let gate: OutputGate | null = null;
let remote: MediaStream | null = null;
let rawLevel: (() => number) | null = null;
let gain: 0 | 1 = 1;
let seq = 0;
const waiters = new Set<(e: Entry, ev: Ev) => void>();

function record(dir: "in" | "out", ev: Ev): Entry {
  const ids: Record<string, string> = {};
  for (const k of ["event_id", "response_id", "item_id", "call_id"]) {
    if (typeof ev[k] === "string") ids[k] = ev[k] as string;
  }
  const resp = ev["response"] as { id?: string; status?: string } | undefined;
  if (resp?.id) ids["response_id"] = resp.id;
  const item = ev["item"] as { id?: string } | undefined;
  if (item?.id) ids["item_id"] = item.id;
  const entry: Entry = { t: now(), dir, type: String(ev["type"]), ids };
  if (resp?.status) entry.status = resp.status;
  const err = ev["error"] as { code?: string } | undefined;
  if (err?.code) entry.status = err.code;
  log.push(entry);
  if (dir === "in") for (const w of [...waiters]) w(entry, ev);
  return entry;
}

const send = (ev: Ev) => {
  record("out", ev);
  dc?.send(JSON.stringify(ev));
};

function waitFor(pred: (e: Entry, ev: Ev) => boolean, ms = 15_000): Promise<Entry | null> {
  return new Promise((resolve) => {
    const w = (e: Entry, ev: Ev) => {
      if (!pred(e, ev)) return;
      waiters.delete(w);
      clearTimeout(timer);
      resolve(e);
    };
    const timer = setTimeout(() => {
      waiters.delete(w);
      resolve(null);
    }, ms);
    waiters.add(w);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SENTENCE = "GLP-1 is a hormone your gut releases after you eat.";
const LONG =
  "GLP-1 medicines copy a natural gut hormone, slow how fast the stomach empties, help the pancreas release insulin when blood sugar is high, and signal fullness to the brain, which is why people often eat less.";

/** Sends a response and returns the request id carried in metadata. */
function say(text: string, outOfBand = false): string {
  const requestId = `spike_${++seq}`;
  send({
    type: CLIENT.responseCreate,
    response: {
      ...(outOfBand ? { conversation: "none" } : {}),
      instructions: `Say exactly this sentence and nothing else: "${text}"`,
      tool_choice: "none",
      metadata: { requestId },
    },
  });
  return requestId;
}

const isType = (type: string) => (e: Entry) => e.type === type;

async function responseIdFor(requestId: string): Promise<string | null> {
  const e = await waitFor((en, ev) => {
    const meta = (ev["response"] as { metadata?: { requestId?: string } } | undefined)?.metadata;
    return en.type === SERVER.responseCreated && meta?.requestId === requestId;
  });
  return e?.ids["response_id"] ?? null;
}

async function connect() {
  ctx ??= new AudioContext();
  await ctx.resume();
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`/api/session ${res.status}`);
  // The secret is used for the SDP exchange below and never stored or logged.
  const { clientSecret } = (await res.json()) as { clientSecret: string };

  pc = new RTCPeerConnection();
  pc.ontrack = (e) => {
    remote = e.streams[0] ?? null;
    if (!remote || !ctx) return;
    // Raw analyser with NO media element attached, to test whether Chrome feeds Web Audio without one.
    const src = ctx.createMediaStreamSource(remote);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    rawLevel = () => (an.getFloatTimeDomainData(buf), rms(buf));
  };
  if (($("useMic") as HTMLInputElement).checked) {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of mic.getAudioTracks()) pc.addTrack(t, mic);
  } else {
    pc.addTransceiver("audio", { direction: "recvonly" });
  }
  dc = pc.createDataChannel(DATA_CHANNEL);
  dc.onmessage = (m) => record("in", JSON.parse(String(m.data)) as Ev);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdp = await fetch(CALLS_URL, {
    method: "POST",
    body: offer.sdp ?? "",
    headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
  });
  if (!sdp.ok) throw new Error(`calls ${sdp.status}`);
  const callId = sdp.headers.get("Location")?.split("/").pop() ?? "(no Location header)";
  $("callId").textContent = callId;
  results["callId"] = callId;
  await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
  await new Promise<void>((r) => (dc!.readyState === "open" ? r() : (dc!.onopen = () => r())));
  setStatus("connected");
}

function attachGate() {
  if (!gate && remote && ctx) gate = createOutputGate(remote, ctx);
  gate?.setGain(gain);
}

/** Samples a level function every 50 ms for `ms`; returns the max. */
async function peak(level: () => number, ms: number): Promise<number> {
  let max = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    max = Math.max(max, level());
    await sleep(50);
  }
  return Number(max.toFixed(4));
}

async function waitStopped(rid: string | null, ms = 20_000) {
  return waitFor(
    (e) =>
      e.type === SERVER.audioStopped &&
      (!rid || !e.ids["response_id"] || e.ids["response_id"] === rid),
    ms,
  );
}

const since = (from: number) =>
  log.filter((e) => e.t >= from).map((e) => ({ ...e, t: e.t - from }));

async function scenarioWebAudioWithoutElement() {
  const from = now();
  const rid = await responseIdFor(say(SENTENCE));
  await waitFor(isType(SERVER.audioStarted));
  const level = await peak(() => rawLevel?.() ?? 0, 1500);
  await waitStopped(rid);
  results["webAudioWithoutMediaElement"] = {
    rawPeakRms: level,
    feedsWithoutElement: level > 0.002,
  };
  return since(from);
}

async function scenarioSay() {
  const from = now();
  const rid = await responseIdFor(say(SENTENCE));
  const done = await waitFor((e) => e.type === SERVER.responseDone && e.ids["response_id"] === rid);
  const stopped = await waitStopped(rid);
  const events = since(from);
  const buffer = events.filter((e) => e.type.startsWith("output_audio_buffer."));
  results["say"] = {
    order: events.filter((e) => e.dir === "in").map((e) => e.type),
    bufferEventsCarryResponseId:
      buffer.length > 0 && buffer.every((e) => e.ids["response_id"] === rid),
    doneToStoppedMs: done && stopped ? stopped.t - done.t : null,
  };
  return events;
}

async function scenarioInterrupt() {
  const from = now();
  const rid = await responseIdFor(say(LONG));
  const started = await waitFor(isType(SERVER.audioStarted));
  await sleep(700);
  const sentAt = now();
  send({ type: CLIENT.responseCancel });
  send({ type: CLIENT.audioClear });
  const done = await waitFor(
    (e) => e.type === SERVER.responseDone && e.ids["response_id"] === rid,
    3000,
  );
  const cleared = await waitFor(isType(SERVER.audioCleared), 3000);
  await sleep(500);
  const events = since(from);
  results["interrupt"] = {
    started: Boolean(started),
    responseDoneStatus: done?.status ?? "(no response.done after cancel)",
    cancelToDoneMs: done ? done.t - sentAt : null,
    clearToClearedMs: cleared ? cleared.t - sentAt : null,
    clearedCarriesResponseId: cleared ? cleared.ids["response_id"] === rid : null,
    assistantItemTruncated: events.some((e) => e.type === "conversation.item.truncated"),
  };
  return events;
}

async function scenarioOutOfBand() {
  const from = now();
  const rid = await responseIdFor(say(SENTENCE, true));
  const started = await waitFor(isType(SERVER.audioStarted));
  const stopped = await waitStopped(rid);
  const first = since(from);
  // Second out-of-band sentence, cleared mid-way.
  const from2 = now();
  const rid2 = await responseIdFor(say(LONG, true));
  await waitFor(isType(SERVER.audioStarted));
  await sleep(600);
  send({ type: CLIENT.responseCancel });
  send({ type: CLIENT.audioClear });
  const cleared = await waitFor(isType(SERVER.audioCleared), 3000);
  await sleep(500);
  const both = [...first, ...since(from2)];
  const addedToConversation = both.some(
    (e) =>
      (e.type === "conversation.item.added" || e.type === SERVER.itemCreated) && e.dir === "in",
  );
  results["outOfBand"] = {
    responseIds: [rid, rid2],
    bufferEventsFired: Boolean(started && stopped),
    clearWorks: Boolean(cleared),
    addedToConversation,
  };
  return both;
}

async function scenarioBackToBack(n: number) {
  const from = now();
  const gaps: number[] = [];
  const audibleGaps: number[] = [];
  let prevStopped: Entry | null = null;
  for (let i = 0; i < n; i++) {
    const sentAt = now();
    const rid = await responseIdFor(say(`Sentence ${i + 1}. ${SENTENCE}`));
    const started = await waitFor(isType(SERVER.audioStarted));
    // First audible output after the gate, polled every 10 ms.
    let audibleAt: number | null = null;
    for (let k = 0; k < 300 && gate; k++) {
      if (gate.level() > 0.002) {
        audibleAt = now();
        break;
      }
      await sleep(10);
    }
    if (prevStopped && started) gaps.push(started.t - prevStopped.t);
    if (prevStopped && audibleAt !== null) audibleGaps.push(audibleAt - prevStopped.t);
    else if (audibleAt !== null && i === 0)
      results["firstSentenceSendToAudibleMs"] = audibleAt - sentAt;
    prevStopped = await waitStopped(rid);
  }
  const p50 = (xs: number[]) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
  results["backToBack"] = {
    n,
    stoppedToStartedP50Ms: p50(gaps),
    stoppedToAudibleP50Ms: p50(audibleGaps),
    stoppedToStartedMs: gaps,
  };
  return since(from);
}

async function scenarioGate() {
  const from = now();
  const rid = await responseIdFor(say(LONG));
  await waitFor(isType(SERVER.audioStarted));
  gate?.setGain(1);
  const open = await peak(() => gate?.level() ?? 0, 800);
  gate?.setGain(0);
  // One analyser frame (~11 ms) can still hold pre-mute samples; sample after it has refilled.
  await sleep(100);
  const ctxTimeBefore = ctx?.currentTime ?? 0;
  const muted = await peak(() => gate?.level() ?? 0, 800);
  const ctxAdvancedMs = Math.round(((ctx?.currentTime ?? 0) - ctxTimeBefore) * 1000);
  gate?.setGain(1);
  await waitStopped(rid);
  results["gate"] = {
    audioContextState: ctx?.state,
    audioContextAdvancedMsDuring800msSample: ctxAdvancedMs,
    visibility: document.visibilityState,
    postGatePeakRmsGain1: open,
    postGatePeakRmsGain0: muted,
    silentWhenMuted: muted <= 0.002,
  };
  show();
  return since(from);
}

async function scenarioQuestions() {
  const from = now();
  const answers = [];
  for (const q of SPIKE_QUESTIONS) {
    answers.push(
      await askOne(q, {
        send,
        next: async (pred, ms) => {
          let hit: Ev | null = null;
          await waitFor((_e, ev) => (pred(ev) ? ((hit = ev), true) : false), ms);
          return hit;
        },
      }),
    );
    await waitFor(isType(SERVER.audioStopped), 20_000);
  }
  results["questionsAudio"] = answers;
  return since(from);
}

async function runAll() {
  const timelines: Record<string, Entry[]> = {};
  setStatus("connecting");
  if (!dc) await connect();
  setStatus("webAudioWithoutElement");
  timelines["webAudioWithoutElement"] = await scenarioWebAudioWithoutElement();
  attachGate();
  for (const [name, fn] of [
    ["say", scenarioSay],
    ["interrupt", scenarioInterrupt],
    ["outOfBand", scenarioOutOfBand],
    ["gate", scenarioGate],
    ["backToBack", () => scenarioBackToBack(20)],
    ["questions", scenarioQuestions],
  ] as const) {
    setStatus(name);
    timelines[name] = await fn();
    show();
  }
  results["timelines"] = timelines;
  setStatus("done");
  show();
  (window as unknown as { __spike: unknown }).__spike = results;
}

function hangup() {
  dc?.close();
  pc?.close();
  gate?.close();
  dc = null;
  pc = null;
  gate = null;
  setStatus("closed");
}

const on = (id: string, fn: () => unknown) =>
  $(id).addEventListener("click", () => {
    void Promise.resolve(fn()).catch((e: unknown) => setStatus(`error: ${String(e)}`));
  });
on("connect", async () => (await connect(), attachGate()));
on("say", () => say(SENTENCE));
on("sayOob", () => say(SENTENCE, true));
on("interrupt", () => (send({ type: CLIENT.responseCancel }), send({ type: CLIENT.audioClear })));
on("commit", () => send({ type: CLIENT.inputCommit }));
on("gain", () => ((gain = gain ? 0 : 1), gate?.setGain(gain)));
on("hangup", hangup);
on("gateTest", scenarioGate);
on("runAll", runAll);
on("copy", () => navigator.clipboard.writeText(JSON.stringify({ results, log }, null, 2)));
(window as unknown as { __spikeLog: Entry[] }).__spikeLog = log;
// Console access for ad-hoc probes (e.g. response.cancel with a response_id).
(window as unknown as { __spikeSend: typeof send }).__spikeSend = send;
