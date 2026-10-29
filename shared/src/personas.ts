import { z } from "zod";

/** The product name. Presenters are personas inside it (brief §6.1). */
export const PRODUCT_NAME = "Podium";

/**
 * Presenters the listener can choose on the landing page (brief §6.1, arch §5.1). Only the name
 * and the Realtime voice differ; persona traits, policy, facts and tools are shared.
 */
export const PERSONAS = [
  { id: "ava", name: "Ava", voice: "marin", tone: "Warm, measured" },
  { id: "theo", name: "Theo", voice: "cedar", tone: "Calm, low" },
  { id: "mira", name: "Mira", voice: "coral", tone: "Bright, quick" },
] as const;

export type Persona = (typeof PERSONAS)[number];
export type PersonaId = Persona["id"];

export const DEFAULT_PERSONA: PersonaId = "ava";
export const PERSONA_IDS = PERSONAS.map((p) => p.id) as [PersonaId, ...PersonaId[]];
export const PersonaIdSchema = z.enum(PERSONA_IDS);

/** The persona for an id; unknown or missing ids fall back to Ava. */
export function personaById(id: PersonaId = DEFAULT_PERSONA): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}
