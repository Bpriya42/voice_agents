import { describe, expect, it } from "vitest";
import { isEndCommand } from "./endCommand.js";

describe("isEndCommand", () => {
  it.each([
    "end presentation",
    "End the presentation.",
    "Ava, end the presentation",
    "ya end it",
    "Yes, end it please",
    "okay end it now",
    "can you end the talk",
    "stop the presentation",
  ])("ends on %j", (text) => expect(isEndCommand(text)).toBe(true));

  it.each([
    "",
    "stop",
    "end",
    "thank you",
    "I'm done",
    "How does the treatment end?",
    "When do the side effects stop?",
    "What happens if I stop taking it?",
    "go back to the end slide",
  ])("does not end on %j", (text) => expect(isEndCommand(text)).toBe(false));
});
