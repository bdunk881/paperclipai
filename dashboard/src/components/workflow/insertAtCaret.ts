/**
 * insertAtCaret — caret-aware text insertion for text + textarea inputs.
 *
 * Used by NodeConfigForm's TextFieldInput + LongTextFieldInput when
 * the VariablePicker (HEL-241B) inserts a `{{key}}` literal. Returns
 * both the next string and the caret position so the caller can
 * restore focus + selection on the next animation frame.
 */
import type { RefObject } from "react";

export function insertAtCaret(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  currentValue: string,
  literal: string,
): { next: string; nextCaret: number } {
  const el = ref.current;
  if (!el) {
    const next = currentValue + literal;
    return { next, nextCaret: next.length };
  }
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const next = currentValue.slice(0, start) + literal + currentValue.slice(end);
  return { next, nextCaret: start + literal.length };
}
