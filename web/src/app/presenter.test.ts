import { describe, expect, it } from "vitest";
import { PRESENTER_KEY, readStoredPresenter, writeStoredPresenter } from "./presenter.js";

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

describe("presenter storage", () => {
  it("is Ava when nothing is saved or storage is missing", () => {
    expect(readStoredPresenter(memory())).toBe("ava");
    expect(readStoredPresenter(undefined)).toBe("ava");
  });

  it("restores a saved presenter", () => {
    expect(readStoredPresenter(memory({ [PRESENTER_KEY]: "theo" }))).toBe("theo");
  });

  it("ignores an unknown value", () => {
    expect(readStoredPresenter(memory({ [PRESENTER_KEY]: "bob" }))).toBe("ava");
  });

  it("saves the choice, and blocked storage neither throws nor remembers", () => {
    const store = memory();
    writeStoredPresenter(store, "mira");
    expect(store.data[PRESENTER_KEY]).toBe("mira");
    expect(() => writeStoredPresenter(throwing, "mira")).not.toThrow();
    expect(readStoredPresenter(throwing)).toBe("ava");
  });
});
