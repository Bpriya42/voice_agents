import { describe, expect, it } from "vitest";
import { createOpenAIClient, OpenAIError } from "./openai.js";

const KEY = "test-openai-key-not-real";

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const s = { url: String(url), init };
    seen.push(s);
    return respond(s);
  }) as typeof fetch;
  return { impl, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createOpenAIClient (fake fetch, no network)", () => {
  it("sends the key as a bearer header only", async () => {
    const { impl, seen } = fakeFetch(() => json({}));
    await createOpenAIClient(KEY, impl).checkModel("m");
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.url).not.toContain(KEY);
    expect(String(seen[0]!.init.body ?? "")).not.toContain(KEY);
  });

  it("checkModel: ok, unauthorized, error, and url-encodes the model", async () => {
    const ok = fakeFetch(() => json({ id: "m" }));
    expect(await createOpenAIClient(KEY, ok.impl).checkModel("a/b c")).toBe("ok");
    expect(ok.seen[0]!.url).toBe("https://api.openai.com/v1/models/a%2Fb%20c");
    expect(await createOpenAIClient(KEY, fakeFetch(() => json({}, 401)).impl).checkModel("m")).toBe(
      "unauthorized",
    );
    expect(await createOpenAIClient(KEY, fakeFetch(() => json({}, 500)).impl).checkModel("m")).toBe(
      "error",
    );
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await createOpenAIClient(KEY, down.impl).checkModel("m")).toBe("error");
  });

  it("createClientSecret: posts the session with a 60 s expiry and returns the secret", async () => {
    const { impl, seen } = fakeFetch(() => json({ value: "ek_test_x", expires_at: 123 }));
    const out = await createOpenAIClient(KEY, impl).createClientSecret({ type: "realtime" }, 60);
    expect(out).toEqual({ value: "ek_test_x", expiresAt: 123 });
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: { type: "realtime" },
    });
  });

  it("createClientSecret: rejects a malformed success body", async () => {
    const c = createOpenAIClient(KEY, fakeFetch(() => json({ nope: true })).impl);
    await expect(c.createClientSecret({}, 60)).rejects.toMatchObject({
      status: 502,
      code: "bad_response",
    });
  });

  it("errors carry status and code only, never the response body", async () => {
    const { impl } = fakeFetch(() =>
      json({ error: { code: "insufficient_quota", message: `echo of ${KEY}` } }, 429),
    );
    const err = await createOpenAIClient(KEY, impl)
      .createClientSecret({}, 60)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect(err).toMatchObject({ status: 429, code: "insufficient_quota" });
    expect((err as Error).message).toBe("OpenAI request failed (429, insufficient_quota)");
    expect((err as Error).message).not.toContain(KEY);
  });

  it("errors cope with a non-JSON error body", async () => {
    const { impl } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(createOpenAIClient(KEY, impl).hangup("c")).rejects.toMatchObject({
      status: 502,
      code: undefined,
    });
  });

  it("chatJson: sends strict json_schema and parses the message content", async () => {
    const { impl, seen } = fakeFetch(() =>
      json({ choices: [{ message: { content: '{"answer":"hi"}' } }] }),
    );
    const out = await createOpenAIClient(KEY, impl).chatJson({
      model: "chat-m",
      system: "sys",
      messages: [{ role: "user", content: "q" }],
      schema: { type: "object" },
    });
    expect(out).toEqual({ answer: "hi" });
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body.model).toBe("chat-m");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
    ]);
    expect(body.response_format.json_schema).toMatchObject({ name: "answer", strict: true });
  });

  it.each([
    ["non-JSON content", { choices: [{ message: { content: "not json" } }] }],
    ["null content", { choices: [{ message: { content: null } }] }],
    ["no choices", { choices: [] }],
  ])("chatJson: %s is a bad_response", async (_, body) => {
    const c = createOpenAIClient(KEY, fakeFetch(() => json(body)).impl);
    await expect(
      c.chatJson({ model: "m", system: "s", messages: [], schema: {} }),
    ).rejects.toMatchObject({ status: 502, code: "bad_response" });
  });

  it("hangup: posts to the encoded call path", async () => {
    const { impl, seen } = fakeFetch(() => json({}));
    await createOpenAIClient(KEY, impl).hangup("rtc/1");
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/realtime/calls/rtc%2F1/hangup");
    expect(seen[0]!.init.method).toBe("POST");
  });

  it("applies a request timeout signal", async () => {
    const { impl, seen } = fakeFetch(() => json({}));
    await createOpenAIClient(KEY, impl).checkModel("m");
    expect(seen[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});
