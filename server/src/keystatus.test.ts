import { describe, expect, it } from "vitest";
import { createKeyStatus } from "./keystatus.js";
import { fakeOpenAI } from "../test/fakes.js";

describe("createKeyStatus", () => {
  it("is null without a client and never calls out", async () => {
    const s = createKeyStatus(null, "m");
    expect(await s.get()).toBeNull();
    await s.refresh();
  });

  it("caches a definite answer", async () => {
    const openai = fakeOpenAI();
    const s = createKeyStatus(openai, "m");
    expect(await s.get()).toBe(true);
    expect(await s.get()).toBe(true);
    expect(openai.calls).toEqual(["checkModel"]);
  });

  it("deduplicates concurrent checks", async () => {
    const openai = fakeOpenAI();
    const s = createKeyStatus(openai, "m");
    await Promise.all([s.get(), s.get(), s.get()]);
    expect(openai.calls).toEqual(["checkModel"]);
  });

  it("retries an unknown answer only after 30 seconds", async () => {
    let t = 0;
    let result: "error" | "ok" = "error";
    const openai = fakeOpenAI({ checkModel: async () => result });
    const s = createKeyStatus(openai, "m", () => t);
    expect(await s.get()).toBeNull();
    result = "ok";
    t = 29_000;
    expect(await s.get()).toBeNull();
    t = 31_000;
    expect(await s.get()).toBe(true);
  });

  it("maps unauthorized to false and refresh updates the answer", async () => {
    let result: "unauthorized" | "ok" = "unauthorized";
    const s = createKeyStatus(fakeOpenAI({ checkModel: async () => result }), "m");
    expect(await s.get()).toBe(false);
    result = "ok";
    await s.refresh();
    expect(await s.get()).toBe(true);
  });

  it("treats a throwing check as unknown", async () => {
    const s = createKeyStatus(
      fakeOpenAI({
        checkModel: async () => {
          throw new Error("boom");
        },
      }),
      "m",
    );
    expect(await s.get()).toBeNull();
  });
});
