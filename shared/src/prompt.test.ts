import { describe, expect, it } from "vitest";
import { deck, slideById, SLIDE_IDS } from "./deck.js";
import {
  answerReanchor,
  chatSystemPrompt,
  endOfferInstructions,
  endOfferLine,
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

  it("narration and greeting say the sentence exactly, with nothing added", () => {
    const slide = slideById("intro");
    const bridges = [undefined, "resume", "return", "reconnect"] as const;
    for (const bridge of bridges) {
      const text = narrationInstructions(
        bridge ? { slide, sentenceIndex: 2, bridge } : { slide, sentenceIndex: 2 },
      );
      expect(text).toMatch(/say exactly this sentence and nothing (else )?before or after it/i);
      expect(text).toContain("Do not add facts, definitions or explanations.");
      expect(text).not.toContain("close to its wording");
    }
    expect(greetingInstructions()).toContain(
      "Say exactly this greeting and nothing before or after it.",
    );
  });

  it("only the greeting may greet: answers and narration never greet again", () => {
    const rule = "never greet the listener again";
    expect(sessionInstructions()).toContain(rule);
    expect(answerReanchor()).toContain(rule);
    const slide = slideById("mechanism");
    for (const bridge of ["resume", "return", "reconnect"] as const) {
      expect(narrationInstructions({ slide, sentenceIndex: 1, bridge })).toContain(rule);
    }
    expect(greetingInstructions()).not.toContain(rule);
  });

  it("silence, noise and unintelligible turns are resume_presentation cases", () => {
    for (const text of [sessionInstructions(), answerReanchor()]) {
      expect(text).toContain(
        "If the turn is silent, only noise, or unintelligible, call resume_presentation",
      );
    }
    expect(TOOLS[1].description).toContain("silence");
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

describe("ending the talk", () => {
  it("wrap-up phrases offer to end; an explicit request ends; a bare thanks resumes", () => {
    for (const text of [sessionInstructions(), answerReanchor()]) {
      expect(text).toContain("call offer_end and say nothing else");
      expect(text).toContain("call end_presentation and say nothing else");
      expect(text).toContain(
        "A bare 'thanks' or 'thank you' in the middle of the talk is a backchannel",
      );
      expect(text).toContain("Never thank them or say goodbye yourself.");
    }
  });

  it("only a finished talk treats 'no' to the final question as finished", () => {
    const rule = "If the listener says they have no questions";
    expect(answerReanchor({ finished: true })).toContain(rule);
    expect(answerReanchor({ finished: true })).toContain("'Any final questions?'");
    expect(answerReanchor()).not.toContain(rule);
    expect(sessionInstructions()).not.toContain(rule);
  });

  it("the end offer is one fixed line, with the right input hint and no tools", () => {
    expect(endOfferLine()).toBe(
      `If you'd like to end the call, press the red stop button at the bottom of the presentation, or hold Space and say "end presentation".`,
    );
    expect(endOfferLine({ textOnly: true })).toBe(
      `If you'd like to end the call, press the red stop button at the bottom of the presentation, or type "end presentation".`,
    );
    const text = endOfferInstructions();
    expect(text).toContain(`SENTENCE: ${endOfferLine()}`);
    expect(text).toContain("Say exactly this sentence and nothing before or after it.");
    expect(text).toContain("Do not call tools.");
    expect(text).toContain(PERSONA_MARK);
    expect(text).not.toContain("REVIEWED FACTS");
  });

  it("offer_end and end_presentation take no arguments", () => {
    for (const t of TOOLS.slice(2)) expect(t.parameters.properties).toEqual({});
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
    expect(cfg.tools.map((t) => t.name)).toEqual([
      "goto_slide",
      "resume_presentation",
      "offer_end",
      "end_presentation",
    ]);
    expect(cfg.instructions).toBe(sessionInstructions());
  });
});
