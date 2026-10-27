// Spike S, text-only scenario: the same session config with text output, from Node over WebSocket.
// Run: node --import tsx --env-file=.env scripts/spike/text-session.ts
// Prints tool calls and answer word counts only. Never prints the key or answer text.
import WebSocket from "ws";
import { sessionConfig } from "@ava/shared";
import { SPIKE_QUESTIONS, askOne } from "../../web/src/spike/questions.js";

type Ev = Record<string, unknown>;
const key = process.env["OPENAI_API_KEY"];
if (!key) throw new Error("OPENAI_API_KEY is not set");
const model = process.env["OPENAI_REALTIME_MODEL"] || "gpt-realtime";

const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
  headers: { Authorization: `Bearer ${key}` },
});
const waiters = new Set<(ev: Ev) => void>();
const errors: string[] = [];
ws.on("message", (data) => {
  const ev = JSON.parse(String(data)) as Ev;
  if (ev["type"] === "error") errors.push(String((ev["error"] as Ev | undefined)?.["code"]));
  for (const w of [...waiters]) w(ev);
});
const send = (ev: Ev) => ws.send(JSON.stringify(ev));
const next = (pred: (ev: Ev) => boolean, ms = 30_000) =>
  new Promise<Ev | null>((resolve) => {
    const w = (ev: Ev) => {
      if (!pred(ev)) return;
      waiters.delete(w);
      clearTimeout(t);
      resolve(ev);
    };
    const t = setTimeout(() => (waiters.delete(w), resolve(null)), ms);
    waiters.add(w);
  });

await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
// Same config as the audio session, with text output instead of audio.
const config: Record<string, unknown> = { ...sessionConfig({ model, voice: "alloy" }) };
delete config["audio"];
send({ type: "session.update", session: { ...config, output_modalities: ["text"] } });
const updated = await next((ev) => ev["type"] === "session.updated", 10_000);

const answers = [];
for (const q of SPIKE_QUESTIONS) answers.push(await askOne(q, { send, next }));
ws.close();
console.log(
  JSON.stringify(
    { model, sessionUpdated: Boolean(updated), errors, questionsText: answers },
    null,
    2,
  ),
);
