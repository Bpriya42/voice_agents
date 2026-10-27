import { describe, expect, it } from "vitest";
import { CaptionLog } from "./captions.js";

describe("CaptionLog", () => {
  it("accumulates agent deltas and closes an interrupted line with a dash", () => {
    const log = new CaptionLog();
    log.agent("r1", "GLP-1 is ", false, "narration", false);
    log.agent("r1", "a hormone", false, "narration", false);
    log.interrupted("r1");
    log.agent("r1", " that", false, "narration", false); // late delta dropped
    expect(log.view).toEqual([
      expect.objectContaining({
        id: "r1",
        who: "ava",
        text: "GLP-1 is a hormone",
        interrupted: true,
        final: true,
      }),
    ]);
  });

  it("marks a fully generated but cleared line as interrupted too", () => {
    const log = new CaptionLog();
    log.agent("r1", "Done.", true, "narration", false);
    log.interrupted("r1");
    expect(log.view[0]!.interrupted).toBe(true);
  });

  it("drops deltas for cancelled responses", () => {
    const log = new CaptionLog();
    log.agent("r1", "nope", false, "answer", true);
    expect(log.view).toHaveLength(0);
  });

  it("a late user transcript lands in its reserved line, above the answer", () => {
    const log = new CaptionLog();
    log.reserveUser("u1");
    log.agent("r1", "Because…", true, "answer", false);
    log.user("u1", "Why do", false);
    log.user("u1", " people eat less?", false);
    expect(log.view.map((l) => l.text)).toEqual(["Why do people eat less?", "Because…"]);
    log.user("u1", "Why do people eat less?", true);
    expect(log.view[0]).toMatchObject({ who: "you", final: true, pending: false });
  });

  it("an unreserved transcript is appended; an empty reserved line can be dropped", () => {
    const log = new CaptionLog();
    log.user("u9", "Hello", true);
    log.reserveUser("u2");
    log.reserveUser("u2");
    expect(log.view).toHaveLength(2);
    log.dropUser("u2");
    expect(log.view.map((l) => l.id)).toEqual(["u9"]);
  });

  it("typed questions show at once; answers with numbers get a source line", () => {
    const log = new CaptionLog();
    log.userTyped("u1", "How much weight?");
    log.agent(
      "r1",
      "In STEP-1, people lost 14.9 percent versus 2.4 percent on placebo.",
      true,
      "answer",
      false,
    );
    expect(log.view[1]!.sources).toEqual(["STEP-1, Wilding, NEJM 2021"]);
    expect(log.factIdsOf(["r1"])).toEqual(["evid-2"]);
    expect(log.textOf("u1")).toBe("How much weight?");
  });

  it("narration never gets a source line", () => {
    const log = new CaptionLog();
    log.agent("r1", "In STEP-1, 14.9 percent.", true, "narration", false);
    expect(log.view[0]!.sources).toEqual([]);
  });

  it("clear empties the log", () => {
    const log = new CaptionLog();
    log.userTyped("u1", "x");
    log.clear();
    expect(log.view).toEqual([]);
  });
});
