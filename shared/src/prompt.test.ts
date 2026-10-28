import { describe, expect, it } from "vitest";
import { deck, slideById, SLIDE_IDS } from "./deck.js";
import {
  answerReanchor,
  chatSystemPrompt,
  greetingInstructions,
  narrationInstructions,
  reconnectNote,
  sessionConfig,
  sessionInstructions,
  TOOLS,
} from "./prompt.js";

const PERSONA_MARK = "You are Ava, a calm, clear medical educator";
const POLICY_MARK = "Never add medical knowledge that is not in the facts.";

describe("prompt snapshots", () => {
  it("sessionInstructions", () => expect(sessionInstructions()).toMatchSnapshot());
  it("answerReanchor", () => expect(answerReanchor()).toMatchSnapshot());
  it("chatSystemPrompt", () => expect(chatSystemPrompt("safety")).toMatchSnapshot());

  const slide = slideById("mechanism");
  it.each([
    ["no bridge", undefined],
    ["resume", "resume"],
    ["return", "return"],
    ["reconnect", "reconnect"],
  ] as const)("narrationInstructions: %s", (_, bridge) => {
    const input = bridge ? { slide, sentenceIndex: 1, bridge } : { slide, sentenceIndex: 1 };
    expect(narrationInstructions(input)).toMatchSnapshot();
  });

  it("narrationInstructions: resume with a bridge to avoid repeating", () => {
    expect(
      narrationInstructions({
        slide,
        sentenceIndex: 0,
        bridge: "resume",
        lastBridge: "As I was saying",
      }),
    ).toMatchSnapshot();
  });

  it("reconnectNote", () =>
    expect(
      reconnectNote({
        displayedSlide: "safety",
        checkpoint: { slideId: "mechanism", sentenceIndex: 2 },
        status: "running",
        coveredSlides: ["intro", "mechanism"],
      }),
    ).toMatchSnapshot());
});

describe("prompt contents", () => {
  it("greetingInstructions carries persona and policy, names the input hint, and no tools", () => {
    expect(greetingInstructions()).toMatchSnapshot();
    const voice = greetingInstructions();
    const text = greetingInstructions({ textOnly: true });
    for (const t of [voice, text]) {
      expect(t).toContain(PERSONA_MARK);
      expect(t).toContain(POLICY_MARK);
      expect(t).toContain("Do not call tools.");
      expect(t).not.toContain("REVIEWED FACTS");
    }
    expect(voice).toContain("hold Space");
    expect(text).not.toContain("Space");
  });

  it("narrationInstructions always carries persona and the deck-only rule", () => {
    for (const s of deck) {
      const text = narrationInstructions({ slide: s, sentenceIndex: 0 });
      expect(text).toContain(PERSONA_MARK);
      expect(text).toContain(POLICY_MARK);
      expect(text).toContain(`SENTENCE: ${s.segments[0]!.text}`);
      expect(text).toContain("Do not call tools.");
    }
  });

  it("narrationInstructions does not carry the fact list or tool rules", () => {
    const text = narrationInstructions({ slide: slideById("intro"), sentenceIndex: 0 });
    expect(text).not.toContain("REVIEWED FACTS");
    expect(text).not.toContain("goto_slide");
  });

  it("narrationInstructions throws for a missing sentence", () => {
    expect(() => narrationInstructions({ slide: slideById("intro"), sentenceIndex: 99 })).toThrow();
  });

  it("sessionInstructions contains every fact id and never 'general background'", () => {
    const text = sessionInstructions();
    for (const f of deck.flatMap((s) => s.facts)) expect(text).toContain(`[${f.id}]`);
    expect(text.toLowerCase()).not.toContain("general background");
  });

  it("facts are listed with source labels, not raw source ids", () => {
    expect(sessionInstructions()).toContain("(source: STEP-1, Wilding, NEJM 2021)");
  });

  it("answerReanchor and chatSystemPrompt keep persona, policy, facts and tools", () => {
    for (const text of [answerReanchor(), chatSystemPrompt("intro")]) {
      expect(text).toContain(PERSONA_MARK);
      expect(text).toContain(POLICY_MARK);
      expect(text).toContain("REVIEWED FACTS");
      expect(text).toContain("goto_slide");
    }
  });

  it("reconnectNote contains only ids and status", () => {
    const note = reconnectNote({
      displayedSlide: "safety",
      checkpoint: { slideId: "mechanism", sentenceIndex: 2 },
      status: "paused",
      coveredSlides: ["intro", "mechanism"],
    });
    const ids = SLIDE_IDS.join("|");
    expect(note).toMatch(
      new RegExp(
        `^Session restored after a connection drop\\. Do not greet again\\. ` +
          `Slides already presented: (?:none|(?:${ids})(?:, (?:${ids}))*)\\. ` +
          `Current slide: (?:${ids})\\. Next sentence: (?:${ids}) #\\d+\\. ` +
          `Presentation is (?:running|paused|finished)\\.$`,
      ),
    );
  });
});

describe("tools and session config", () => {
  it("goto_slide enum equals SLIDE_IDS", () => {
    expect(TOOLS[0].parameters.properties.slide_id.enum).toEqual([...SLIDE_IDS]);
  });

  it("sessionConfig is manual-turn (no turn detection) with both tools", () => {
    const cfg = sessionConfig({ model: "m", voice: "v" });
    expect(cfg.audio.input.turn_detection).toBeNull();
    expect(cfg.audio.output.voice).toBe("v");
    expect(cfg.tools.map((t) => t.name)).toEqual(["goto_slide", "resume_presentation"]);
    expect(cfg.instructions).toBe(sessionInstructions());
  });
});
