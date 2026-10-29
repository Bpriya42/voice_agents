import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { RETRY_DELAYS_MS, RealtimeText, askOnce } from "./realtimeText.js";

type Ev = Record<string, unknown>;

/**
 * A scripted local stand-in for the Realtime endpoint (no network, no key): it checks the
 * protocol the runner speaks, not the model. `respond` decides each response.
 */
async function fakeServer(respond: (n: number, seen: Ev[]) => Ev[] | { failed: Ev }) {
  const seen: Ev[] = [];
  let responses = 0;
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw) => {
      const ev = JSON.parse(String(raw)) as Ev;
      seen.push(ev);
      if (ev["type"] === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (ev["type"] === "response.create") {
        const out = respond(++responses, seen);
        const response = Array.isArray(out)
          ? { status: "completed", output: out, usage: { total_tokens: 100 * responses } }
          : { status: "failed", output: [], status_details: out.failed };
        ws.send(JSON.stringify({ type: "response.done", response }));
      }
    });
  });
  await new Promise((r) => wss.once("listening", r));
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  return { url, seen, close: () => wss.close() };
}

const text = (t: string) => ({
  id: "m1",
  type: "message",
  content: [{ type: "output_text", text: t }],
});
const call = (name: string, args: object) => ({
  id: `c_${name}`,
  type: "function_call",
  name,
  call_id: `call_${name}`,
  arguments: JSON.stringify(args),
});

let server: Awaited<ReturnType<typeof fakeServer>> | null = null;
afterEach(() => server?.close());

describe("RealtimeText against a scripted server", () => {
  it("uses the app's session config with text output and no audio block", async () => {
    server = await fakeServer(() => [text("Hi.")]);
    const s = await RealtimeText.open("test-key", "m", server.url);
    s.close();
    const update = server.seen.find((e) => e["type"] === "session.update") as {
      session: Record<string, unknown>;
    };
    expect(update.session["output_modalities"]).toEqual(["text"]);
    expect(update.session["audio"]).toBeUndefined();
    expect(update.session["tools"]).toBeDefined();
    expect(String(update.session["instructions"])).toContain("REVIEWED FACTS");
    expect(String(update.session["instructions"])).toMatch(/^You are Ava,/);
  });

  it("speaks as another presenter in the session and in every response", async () => {
    server = await fakeServer(() => [text("Ok.")]);
    await askOnce("q", "intro", "k", "m", server.url, "mira");
    const update = server.seen.find((e) => e["type"] === "session.update") as {
      session: { instructions: string };
    };
    expect(update.session.instructions).toMatch(/^You are Mira,/);
    const creates = server.seen.filter((e) => e["type"] === "response.create") as {
      response: { instructions: string };
    }[];
    expect(creates.length).toBeGreaterThan(0);
    for (const cr of creates) expect(cr.response.instructions).toMatch(/^You are Mira,/);
  });

  it("answers a goto_slide with the tool result, then collects the continuation", async () => {
    server = await fakeServer((n) =>
      n === 1 ? [call("goto_slide", { slide_id: "safety", intent: "answer" })] : [text("Nausea.")],
    );
    const r = await askOnce("What are the side effects?", "mechanism", "k", "m", server.url);
    expect(r.tools).toEqual([
      { name: "goto_slide", args: { slide_id: "safety", intent: "answer" } },
    ]);
    expect(r.text).toBe("Nausea.");
    expect(r.preamble).toBe("");
    const out = server.seen.find(
      (e) => (e["item"] as Ev | undefined)?.["type"] === "function_call_output",
    );
    expect(JSON.parse(String((out?.["item"] as Ev)["output"]))).toMatchObject({
      ok: true,
      slide_title: "Side effects and safety",
    });
    // The response-level instructions are the re-anchor, sent for the answer and the continuation.
    const creates = server.seen.filter((e) => e["type"] === "response.create");
    expect(creates).toHaveLength(2);
  });

  it("records text said in the same response as a tool call as the preamble", async () => {
    server = await fakeServer((n) =>
      n === 1
        ? [
            text("Let me pull that up."),
            call("goto_slide", { slide_id: "safety", intent: "answer" }),
          ]
        : [text("Nausea.")],
    );
    const r = await askOnce("What are the side effects?", "mechanism", "k", "m", server.url);
    expect(r.preamble).toBe("Let me pull that up.");
    expect(r.text).toBe("Let me pull that up. Nausea.");
  });

  it("ends a resume_presentation turn without a continuation", async () => {
    server = await fakeServer(() => [call("resume_presentation", {})]);
    const r = await askOnce("mm-hm", "evidence", "k", "m", server.url);
    expect(r.tools.map((t) => t.name)).toEqual(["resume_presentation"]);
    expect(server.seen.filter((e) => e["type"] === "response.create")).toHaveLength(1);
  });

  it("retries a failed response, then names the reason if it keeps failing", async () => {
    const saved = [...RETRY_DELAYS_MS];
    RETRY_DELAYS_MS.splice(0, saved.length, 1, 1);
    try {
      const limited = { failed: { type: "failed", error: { code: "rate_limit_exceeded" } } };
      server = await fakeServer((n) => (n === 1 ? limited : [text("Ok.")]));
      expect((await askOnce("q", "intro", "k", "m", server.url)).text).toBe("Ok.");
      server.close();

      server = await fakeServer(() => limited);
      await expect(askOnce("q", "intro", "k", "m", server.url)).rejects.toThrow(
        "response failed (failed, rate_limit_exceeded)",
      );
      expect(server.seen.filter((e) => e["type"] === "response.create")).toHaveLength(3);
    } finally {
      RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, ...saved);
    }
  });

  it("reports total tokens and deletes the replaced slide note", async () => {
    server = await fakeServer(() => [text("Ok.")]);
    const s = await RealtimeText.open("k", "m", server.url);
    s.setSlide("intro");
    s.setSlide("uses");
    const turn = await s.ask("What is this?");
    s.close();
    expect(turn.totalTokens).toBe(100);
    expect(server.seen.filter((e) => e["type"] === "conversation.item.delete")).toHaveLength(1);
  });
});
