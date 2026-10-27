import { z } from "zod";

/** Carries only the HTTP status and OpenAI's error code, never a body that could echo input. */
export class OpenAIError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
  ) {
    super(`OpenAI request failed (${status}${code ? `, ${code}` : ""})`);
  }
}

export interface ChatJsonRequest {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: object;
}

export interface OpenAIClient {
  checkModel(model: string): Promise<"ok" | "unauthorized" | "error">;
  createClientSecret(
    session: object,
    seconds: number,
  ): Promise<{ value: string; expiresAt: number }>;
  chatJson(req: ChatJsonRequest): Promise<unknown>;
  hangup(callId: string): Promise<void>;
}

const ClientSecretBody = z.object({ value: z.string().min(1), expires_at: z.number() });
const ChatBody = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

const BASE_URL = "https://api.openai.com/v1";
const TIMEOUT_MS = 10_000;

/** The only module that talks to OpenAI over HTTP, so tests swap it for a fake or a fake fetch. */
export function createOpenAIClient(apiKey: string, fetchImpl: typeof fetch = fetch): OpenAIClient {
  async function call(path: string, init: RequestInit): Promise<Response> {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: unknown } };
      const code = typeof body.error?.code === "string" ? body.error.code : undefined;
      throw new OpenAIError(res.status, code);
    }
    return res;
  }

  return {
    async checkModel(model) {
      try {
        await call(`/models/${encodeURIComponent(model)}`, { method: "GET" });
        return "ok";
      } catch (e) {
        return e instanceof OpenAIError && e.status === 401 ? "unauthorized" : "error";
      }
    },

    async createClientSecret(session, seconds) {
      const res = await call("/realtime/client_secrets", {
        method: "POST",
        body: JSON.stringify({ expires_after: { anchor: "created_at", seconds }, session }),
      });
      const parsed = ClientSecretBody.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new OpenAIError(502, "bad_response");
      return { value: parsed.data.value, expiresAt: parsed.data.expires_at };
    },

    async chatJson({ model, system, messages, schema }) {
      const res = await call("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...messages],
          response_format: {
            type: "json_schema",
            json_schema: { name: "answer", schema, strict: true },
          },
        }),
      });
      const parsed = ChatBody.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new OpenAIError(502, "bad_response");
      try {
        return JSON.parse(parsed.data.choices[0]?.message.content ?? "");
      } catch {
        throw new OpenAIError(502, "bad_response");
      }
    },

    async hangup(callId) {
      await call(`/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
        method: "POST",
        body: "{}",
      });
    },
  };
}
