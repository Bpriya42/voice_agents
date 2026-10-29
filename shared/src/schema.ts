import { z } from "zod";
import { SLIDE_IDS } from "./deck.js";
import { PersonaIdSchema } from "./personas.js";

export const SlideIdSchema = z.enum(SLIDE_IDS);

export const GotoSlideArgs = z
  .object({
    slide_id: SlideIdSchema,
    intent: z.enum(["answer", "user_request", "stay"]),
  })
  .strict();
export type GotoSlideArgs = z.infer<typeof GotoSlideArgs>;

export const ResumeArgs = z.object({}).strict();

export const SessionRequest = z
  .object({
    turnstileToken: z.string().max(2048).optional(),
    reconnectOf: z.string().uuid().optional(),
    persona: PersonaIdSchema.optional(),
  })
  .strict();

export const SessionResponse = z.object({
  clientSecret: z.string(),
  sessionId: z.string().uuid(),
  expiresAt: z.number().int().nullable(),
});

export const CallReport = z.object({ callId: z.string().min(1).max(200) }).strict();

export const QA = z.object({ q: z.string().max(500), a: z.string().max(1500) });
export const ChatRequest = z
  .object({
    question: z.string().min(1).max(500),
    slideId: SlideIdSchema,
    history: z.array(QA).max(6),
    persona: PersonaIdSchema.optional(),
  })
  .strict();

export const ChatResponse = z
  .object({
    answer: z.string().min(1).max(1500),
    goto_slide: GotoSlideArgs.optional(),
    resume: z.boolean().optional(),
  })
  .refine(
    (r) => !(r.resume && r.goto_slide?.intent === "user_request"),
    "conflicting navigation and resume",
  );

export const MetricsReport = z
  .object({
    sessionId: z.string().uuid(),
    metrics: z
      .record(
        z.string().max(40),
        z.object({ p50: z.number(), p90: z.number(), n: z.number().int() }),
      )
      .refine((m) => Object.keys(m).length <= 12),
  })
  .strict();

export const Health = z.object({
  configured: z.boolean(),
  keyValid: z.boolean().nullable(),
  limits: z.object({
    sessionMaxMinutes: z.number().nullable(),
    busy: z.boolean(),
    paused: z.boolean(),
  }),
  public: z.object({ turnstileSiteKey: z.string().optional(), repoUrl: z.string().optional() }),
});
