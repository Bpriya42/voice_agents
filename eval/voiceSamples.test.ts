import { greetingLine } from "@ava/shared";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_MODEL, sampleRequests, writeSamples } from "./voiceSamples.js";

// A made-up value: tests never use a real key or the network.
const KEY = "test-key-not-real";

describe("voice samples", () => {
  it("asks for one clip per presenter, in their voice, saying their own greeting", () => {
    expect(sampleRequests()).toEqual([
      {
        persona: "ava",
        file: "ava.mp3",
        body: {
          model: SAMPLE_MODEL,
          voice: "marin",
          input: greetingLine({ persona: "ava" }),
          response_format: "mp3",
        },
      },
      expect.objectContaining({
        persona: "theo",
        body: expect.objectContaining({ voice: "cedar" }),
      }),
      expect.objectContaining({
        persona: "mira",
        body: expect.objectContaining({ voice: "coral" }),
      }),
    ]);
    expect(sampleRequests()[1]!.body.input).toContain("Hi, I'm Theo.");
  });

  it("writes each clip and sends the key only in the Authorization header", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const files: [string, number][] = [];
    const written = await writeSamples({
      apiKey: KEY,
      outDir: "out",
      fetch: fetch as unknown as typeof globalThis.fetch,
      write: (path, data) => files.push([path, data.length]),
    });
    expect(written).toHaveLength(3);
    expect(files.map(([p]) => p.replace(/\\/g, "/"))).toEqual([
      "out/ava.mp3",
      "out/theo.mp3",
      "out/mira.mp3",
    ]);
    expect(files.every(([, n]) => n === 3)).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);
  });

  it("stops on a failed request without printing the key", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 401 }));
    const run = writeSamples({
      apiKey: KEY,
      outDir: "out",
      fetch: fetch as unknown as typeof globalThis.fetch,
      write: () => {},
    });
    await expect(run).rejects.toThrow("speech request for ava failed with 401");
    await expect(run).rejects.not.toThrow(KEY);
  });
});
