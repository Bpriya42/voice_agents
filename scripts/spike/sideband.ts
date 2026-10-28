// Spike S, sideband scenario: attach to a live WebRTC call by call_id, then hang it up.
// Run while the spike page is connected: node --import tsx --env-file=.env scripts/spike/sideband.ts <call_id>
// Prints event types and status codes only. Never prints the key.
import WebSocket from "ws";

const key = process.env["OPENAI_API_KEY"];
if (!key) throw new Error("OPENAI_API_KEY is not set");
const callId = process.argv[2];
if (!callId) throw new Error("usage: sideband.ts <call_id>");

const t0 = Date.now();
const types: { t: number; type: string }[] = [];
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
  headers: { Authorization: `Bearer ${key}` },
});
ws.on("message", (d) =>
  types.push({
    t: Date.now() - t0,
    type: String((JSON.parse(String(d)) as { type?: string }).type),
  }),
);
let closedAt: number | null = null;
ws.on("close", (code) => {
  closedAt = Date.now() - t0;
  types.push({ t: closedAt, type: `ws_close_${code}` });
});
const opened = await new Promise<boolean>((r) => {
  ws.once("open", () => r(true));
  ws.once("error", () => r(false));
});
// Let the page play something meanwhile, so events flow.
await new Promise((r) => setTimeout(r, 8000));
const hangupAt = Date.now() - t0;
const res = await fetch(
  `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  },
);
await new Promise((r) => setTimeout(r, 3000));
ws.close();
console.log(
  JSON.stringify(
    {
      sidebandOpened: opened,
      eventsReceived: types.length,
      types,
      hangupStatus: res.status,
      hangupAt,
      closedAt,
    },
    null,
    2,
  ),
);
