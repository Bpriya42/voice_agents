import { DEFAULT_PERSONA, PersonaIdSchema, type PersonaId } from "@ava/shared";

/** The presenter chosen on the landing page, remembered per viewer (brief §6.1). */
export const PRESENTER_KEY = "podium-presenter";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The saved presenter, or Ava when there is none, it is unknown, or storage is unavailable. */
export function readStoredPresenter(storage: Storage | undefined): PersonaId {
  try {
    const v = PersonaIdSchema.safeParse(storage?.getItem(PRESENTER_KEY));
    return v.success ? v.data : DEFAULT_PERSONA;
  } catch {
    return DEFAULT_PERSONA;
  }
}

export function writeStoredPresenter(storage: Storage | undefined, persona: PersonaId): void {
  try {
    storage?.setItem(PRESENTER_KEY, persona);
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}
