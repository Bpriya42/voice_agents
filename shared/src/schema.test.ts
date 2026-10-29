import { describe, expect, it } from "vitest";
import {
  CallReport,
  ChatRequest,
  ChatResponse,
  GotoSlideArgs,
  Health,
  MetricsReport,
  ResumeArgs,
  SessionRequest,
} from "./schema.js";

describe("GotoSlideArgs", () => {
  it("accepts a valid call", () => {
    expect(GotoSlideArgs.safeParse({ slide_id: "safety", intent: "answer" }).success).toBe(true);
  });
  it("rejects unknown slide ids, bad intents and extra keys", () => {
    expect(GotoSlideArgs.safeParse({ slide_id: "nope", intent: "answer" }).success).toBe(false);
    expect(GotoSlideArgs.safeParse({ slide_id: "intro", intent: "go" }).success).toBe(false);
    expect(GotoSlideArgs.safeParse({ slide_id: "intro", intent: "stay", extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("ResumeArgs", () => {
  it("accepts only an empty object", () => {
    expect(ResumeArgs.safeParse({}).success).toBe(true);
    expect(ResumeArgs.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe("ChatRequest", () => {
  const base = { question: "What are the side effects?", slideId: "mechanism" as const };
  const qa = { q: "a", a: "b" };

  it("accepts up to 6 history items and rejects 7", () => {
    expect(ChatRequest.safeParse({ ...base, history: Array(6).fill(qa) }).success).toBe(true);
    expect(ChatRequest.safeParse({ ...base, history: Array(7).fill(qa) }).success).toBe(false);
  });
  it("rejects empty and over-long questions", () => {
    expect(ChatRequest.safeParse({ ...base, question: "", history: [] }).success).toBe(false);
    expect(ChatRequest.safeParse({ ...base, question: "x".repeat(501), history: [] }).success).toBe(
      false,
    );
  });
  it("accepts a known presenter and rejects an unknown one", () => {
    expect(ChatRequest.safeParse({ ...base, history: [], persona: "mira" }).success).toBe(true);
    expect(ChatRequest.safeParse({ ...base, history: [], persona: "bob" }).success).toBe(false);
  });
});

describe("ChatResponse", () => {
  it("rejects resume with a user_request navigation", () => {
    const r = ChatResponse.safeParse({
      answer: "ok",
      resume: true,
      goto_slide: { slide_id: "evidence", intent: "user_request" },
    });
    expect(r.success).toBe(false);
  });
  it("allows resume with an answer-intent navigation, and an answer alone", () => {
    expect(
      ChatResponse.safeParse({
        answer: "ok",
        resume: true,
        goto_slide: { slide_id: "evidence", intent: "answer" },
      }).success,
    ).toBe(true);
    expect(ChatResponse.safeParse({ answer: "ok" }).success).toBe(true);
  });
  it("rejects an empty answer", () => {
    expect(ChatResponse.safeParse({ answer: "" }).success).toBe(false);
  });
});

describe("other payloads", () => {
  it("SessionRequest rejects a non-uuid reconnectOf and unknown keys", () => {
    expect(SessionRequest.safeParse({}).success).toBe(true);
    expect(SessionRequest.safeParse({ reconnectOf: "nope" }).success).toBe(false);
    expect(SessionRequest.safeParse({ other: 1 }).success).toBe(false);
  });
  it("SessionRequest accepts a known presenter and rejects an unknown one", () => {
    expect(SessionRequest.safeParse({ persona: "theo" }).success).toBe(true);
    expect(SessionRequest.safeParse({ persona: "bob" }).success).toBe(false);
  });
  it("CallReport needs a non-empty callId", () => {
    expect(CallReport.safeParse({ callId: "" }).success).toBe(false);
    expect(CallReport.safeParse({ callId: "call_1" }).success).toBe(true);
  });
  it("MetricsReport caps the number of metrics at 12", () => {
    const m = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { p50: 1, p90: 2, n: 3 }]));
    const sessionId = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
    expect(MetricsReport.safeParse({ sessionId, metrics: m(12) }).success).toBe(true);
    expect(MetricsReport.safeParse({ sessionId, metrics: m(13) }).success).toBe(false);
  });
  it("Health parses the documented shape", () => {
    expect(
      Health.safeParse({
        configured: true,
        keyValid: null,
        limits: { sessionMaxMinutes: null, busy: false, paused: false },
        public: {},
      }).success,
    ).toBe(true);
  });
});
