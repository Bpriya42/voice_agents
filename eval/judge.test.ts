import { describe, expect, it, vi } from "vitest";
import { judge, JUDGE_DIMENSIONS } from "./judge.js";

const pass = Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, { pass: true, reason: "ok" }]));
const c = { question: "What is GLP-1?", slide: "intro" as const, expect: {} };
const r = { text: "A gut hormone.", tools: [] };

/** A fake chat completions endpoint (no network, no key) that records the rubric it was sent. */
function fakeFetch() {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(pass) } }] })),
  );
  const rubric = () => {
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    return (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[0]!
      .content;
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, rubric };
}

describe("judge rubric", () => {
  it("names Ava by default", async () => {
    const f = fakeFetch();
    await judge(c, r, { apiKey: "k", model: "m", fetch: f.fetch });
    expect(f.rubric()).toContain('spoken answer from "Ava"');
    expect(f.rubric()).toContain("tone: Ava's persona");
  });

  it("names the presenter under test", async () => {
    const f = fakeFetch();
    await judge(c, r, { apiKey: "k", model: "m", fetch: f.fetch, persona: "theo" });
    expect(f.rubric()).toContain('spoken answer from "Theo"');
    expect(f.rubric()).toContain("tone: Theo's persona");
    expect(f.rubric()).not.toContain("Ava");
  });
});
