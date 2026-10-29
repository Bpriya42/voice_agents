import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  PERSONA_IDS,
  PERSONAS,
  PersonaIdSchema,
  personaById,
  PRODUCT_NAME,
} from "./personas.js";

describe("personas", () => {
  it("Ava is the default and the first presenter", () => {
    expect(DEFAULT_PERSONA).toBe("ava");
    expect(PERSONAS[0].id).toBe("ava");
    expect(personaById().name).toBe("Ava");
  });

  it("ids and names are unique, and every presenter has a voice and a tone", () => {
    expect(new Set(PERSONA_IDS).size).toBe(PERSONAS.length);
    expect(new Set(PERSONAS.map((p) => p.name)).size).toBe(PERSONAS.length);
    for (const p of PERSONAS) {
      expect(p.voice).not.toBe("");
      expect(p.tone).not.toBe("");
    }
  });

  it("maps each id to its presenter and falls back to Ava", () => {
    expect(personaById("theo")).toMatchObject({ name: "Theo", voice: "cedar" });
    expect(personaById("mira")).toMatchObject({ name: "Mira", voice: "coral" });
    expect(personaById("nope" as never).id).toBe("ava");
  });

  it("the schema accepts only known ids", () => {
    expect(PersonaIdSchema.safeParse("ava").success).toBe(true);
    expect(PersonaIdSchema.safeParse("Ava").success).toBe(false);
    expect(PersonaIdSchema.safeParse(undefined).success).toBe(false);
  });

  it("the product has a neutral name, not a presenter's", () => {
    expect(PRODUCT_NAME).toBe("Podium");
    expect(PERSONAS.map((p) => p.name)).not.toContain(PRODUCT_NAME);
  });
});
