// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEditableTarget, keyToAction } from "./shortcuts.js";

const down = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  keyToAction({
    key,
    code: extra.code ?? "",
    shiftKey: false,
    repeat: false,
    type: "keydown",
    ...extra,
  });

describe("keyToAction (brief §9)", () => {
  it("maps every shortcut", () => {
    expect(down(" ", { code: "Space" })).toEqual({ action: "talkDown" });
    expect(
      keyToAction({ key: " ", code: "Space", shiftKey: false, repeat: false, type: "keyup" }),
    ).toEqual({ action: "talkUp" });
    expect(down("Escape")).toEqual({ action: "escape" });
    expect(down("p")).toEqual({ action: "pause" });
    expect(down("P", { shiftKey: true })).toEqual({ action: "pause" });
    expect(down("ArrowLeft")).toEqual({ action: "prev" });
    expect(down("ArrowRight")).toEqual({ action: "next" });
    for (let n = 1; n <= 6; n++) expect(down(String(n))).toEqual({ action: "goto", slide: n - 1 });
    expect(down("/")).toEqual({ action: "focusAsk" });
    expect(down("s")).toEqual({ action: "stay" });
    expect(down("r")).toEqual({ action: "retry" });
    expect(down("E", { shiftKey: true })).toEqual({ action: "end" });
    expect(down("m")).toEqual({ action: "mute" });
    expect(down("?", { shiftKey: true })).toEqual({ action: "help" });
  });

  it("ignores auto-repeat", () => {
    expect(down(" ", { code: "Space", repeat: true })).toBeNull();
    expect(down("ArrowRight", { repeat: true })).toBeNull();
  });

  it("Shift+E is End but e alone is nothing", () => {
    expect(down("e")).toBeNull();
    expect(down("E", { shiftKey: true })).toEqual({ action: "end" });
  });

  it("never takes over browser shortcuts or unmapped keys", () => {
    expect(down("r", { ctrlKey: true })).toBeNull();
    expect(down("1", { metaKey: true })).toBeNull();
    expect(down("ArrowLeft", { altKey: true })).toBeNull();
    expect(down("7")).toBeNull();
    expect(down("x")).toBeNull();
    expect(down("S", { shiftKey: true })).toBeNull();
    expect(
      keyToAction({ key: "p", code: "KeyP", shiftKey: false, repeat: false, type: "keyup" }),
    ).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("is true for inputs, textareas, selects, contenteditable and dialog content", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inDialog = document.createElement("button");
    dialog.appendChild(inDialog);
    document.body.append(input, textarea, select, editable, dialog);
    for (const el of [input, textarea, select, editable, inDialog])
      expect(isEditableTarget(el)).toBe(true);
  });

  it("is false for buttons, the body and non-elements", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
