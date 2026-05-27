/**
 * insertAtCaret tests — caret-aware text insertion utility (HEL-241B).
 */
import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { insertAtCaret } from "./insertAtCaret";

describe("insertAtCaret", () => {
  it("appends when the ref is unbound (initial render)", () => {
    const ref = createRef<HTMLInputElement | HTMLTextAreaElement>();
    const result = insertAtCaret(ref, "hello ", "{{world}}");
    expect(result.next).toBe("hello {{world}}");
    expect(result.nextCaret).toBe("hello {{world}}".length);
  });

  it("inserts at the caret position when the ref is bound", () => {
    const input = document.createElement("input");
    input.value = "abcdef";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const ref = { current: input };
    const result = insertAtCaret(ref, "abcdef", "{{x}}");
    expect(result.next).toBe("abc{{x}}def");
    expect(result.nextCaret).toBe(3 + "{{x}}".length);
  });

  it("replaces the selection range when the user had text highlighted", () => {
    const input = document.createElement("input");
    input.value = "before MIDDLE after";
    input.selectionStart = 7; // start of "MIDDLE"
    input.selectionEnd = 13; // end of "MIDDLE"
    const ref = { current: input };
    const result = insertAtCaret(ref, "before MIDDLE after", "{{X}}");
    expect(result.next).toBe("before {{X}} after");
    expect(result.nextCaret).toBe(7 + "{{X}}".length);
  });
});
