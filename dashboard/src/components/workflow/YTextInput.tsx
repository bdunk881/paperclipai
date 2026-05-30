import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import type * as Y from "yjs";

type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
>;

interface SelectionRange {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

export interface YTextInputProps extends TextInputProps {
  yText: Y.Text | null;
  value: string;
  onChangeValue: (value: string) => void;
}

function insertLength(insert: unknown): number {
  return typeof insert === "string" ? insert.length : 1;
}

function transformIndex(index: number, delta: Y.YTextEvent["delta"]): number {
  let oldOffset = 0;
  let nextIndex = index;

  for (const op of delta) {
    if (op.retain) {
      oldOffset += op.retain;
      continue;
    }

    if (op.insert !== undefined) {
      const length = insertLength(op.insert);
      if (oldOffset <= nextIndex) {
        nextIndex += length;
      }
      continue;
    }

    if (op.delete) {
      const length = op.delete;
      if (oldOffset < nextIndex) {
        nextIndex -= Math.min(length, nextIndex - oldOffset);
      }
    }
  }

  return Math.max(0, nextIndex);
}

function diffText(previous: string, next: string) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    index: start,
    deleteCount: previousEnd - start,
    insertText: next.slice(start, nextEnd),
  };
}

export function YTextInput({
  yText,
  value,
  onChangeValue,
  ...inputProps
}: YTextInputProps) {
  const [inputValue, setInputValue] = useState(() => yText?.toString() ?? value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const localOriginRef = useRef({ component: "YTextInput" });
  const pendingSelectionRef = useRef<SelectionRange | null>(null);

  useEffect(() => {
    if (!yText) {
      setInputValue(value);
      return;
    }
    setInputValue(yText.toString());
  }, [value, yText]);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const input = inputRef.current;
    if (!pending || !input || document.activeElement !== input) return;

    pendingSelectionRef.current = null;
    const end = input.value.length;
    input.setSelectionRange(
      Math.min(pending.start, end),
      Math.min(pending.end, end),
      pending.direction,
    );
  }, [inputValue]);

  useEffect(() => {
    if (!yText) return;

    const handleYTextUpdate = (event: Y.YTextEvent): void => {
      if (event.transaction.origin === localOriginRef.current) return;

      const input = inputRef.current;
      if (
        input &&
        document.activeElement === input &&
        input.selectionStart !== null &&
        input.selectionEnd !== null
      ) {
        pendingSelectionRef.current = {
          start: transformIndex(input.selectionStart, event.delta),
          end: transformIndex(input.selectionEnd, event.delta),
          direction: input.selectionDirection ?? "none",
        };
      }

      const nextValue = yText.toString();
      setInputValue(nextValue);
      onChangeValue(nextValue);
    };

    yText.observe(handleYTextUpdate);
    return () => {
      yText.unobserve(handleYTextUpdate);
    };
  }, [onChangeValue, yText]);

  const applyToYText = useCallback(
    (nextValue: string) => {
      if (!yText) return;
      const previousValue = yText.toString();
      if (previousValue === nextValue) return;

      const { index, deleteCount, insertText } = diffText(previousValue, nextValue);
      const apply = (): void => {
        if (deleteCount > 0) yText.delete(index, deleteCount);
        if (insertText) yText.insert(index, insertText);
      };

      if (yText.doc) {
        yText.doc.transact(apply, localOriginRef.current);
      } else {
        apply();
      }
    },
    [yText],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setInputValue(nextValue);
      onChangeValue(nextValue);
      applyToYText(nextValue);
    },
    [applyToYText, onChangeValue],
  );

  return (
    <input
      {...inputProps}
      ref={inputRef}
      value={inputValue}
      onChange={handleChange}
    />
  );
}
