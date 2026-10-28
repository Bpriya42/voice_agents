import { describe, expect, it } from "vitest";
import { readStoredTheme, resolveTheme, THEME_KEY, writeStoredTheme } from "./theme.js";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("theme", () => {
  it("follows the system when nothing is saved", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("prefers the saved choice over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("round-trips a choice through storage", () => {
    const s = memory();
    writeStoredTheme(s, "dark");
    expect(s.data[THEME_KEY]).toBe("dark");
    expect(readStoredTheme(s)).toBe("dark");
  });

  it("ignores unknown stored values", () => {
    expect(readStoredTheme(memory({ [THEME_KEY]: "sepia" }))).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    expect(readStoredTheme(throwing)).toBeNull();
    expect(() => writeStoredTheme(throwing, "light")).not.toThrow();
    expect(readStoredTheme(undefined)).toBeNull();
  });
});
