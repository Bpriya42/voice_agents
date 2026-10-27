import type { Context } from "hono";
import { ChatRequest, ChatResponse, SLIDE_IDS, chatSystemPrompt } from "@ava/shared";
import type { Deps } from "./app.js";
import { mapOpenAIError } from "./errors.js";

const INTENTS = ["answer", "user_request", "stay"];

/**
 * JSON schema for OpenAI structured output. Strict mode needs every property listed in `required`,
 * so the optional fields of ChatResponse are expressed as nullable here and dropped afterwards.
 */
export const CHAT_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    goto_slide: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            slide_id: { type: "string", enum: [...SLIDE_IDS] },
            intent: { type: "string", enum: INTENTS },
          },
          required: ["slide_id", "intent"],
          additionalProperties: false,
        },
      ],
    },
    resume: { type: ["boolean", "null"] },
  },
  required: ["answer", "goto_slide", "resume"],
  additionalProperties: false,
} as const;

function dropNulls(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
}

/** Backup-voice answers (brief §10): same prompt builder, structured output, validated twice. */
export function chatRoute(deps: Deps) {
  return async (c: Context) => {
    const openai = deps.openai;
    if (!openai) return c.json({ code: "not_configured" }, 503);

    const parsed = ChatRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: "bad_request" }, 400);
    const { question, slideId, history } = parsed.data;

    let raw: unknown;
    try {
      raw = await openai.chatJson({
        model: deps.config.OPENAI_CHAT_MODEL,
        system: chatSystemPrompt(slideId),
        messages: [
          ...history.flatMap((qa) => [
            { role: "user" as const, content: qa.q },
            { role: "assistant" as const, content: qa.a },
          ]),
          { role: "user", content: question },
        ],
        schema: CHAT_JSON_SCHEMA,
      });
    } catch (e) {
      const { status, code } = mapOpenAIError(e, Boolean(deps.config.SESSION_MAX_MINUTES));
      deps.logger.warn("chat_failed", { code });
      return c.json({ code }, status);
    }

    const answer = ChatResponse.safeParse(dropNulls(raw));
    if (!answer.success) {
      // Never forward unvalidated model output.
      deps.logger.warn("chat_invalid_output");
      return c.json({ code: "server_error" }, 502);
    }
    return c.json(answer.data);
  };
}
