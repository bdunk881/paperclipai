import {
  applyRunMetadataOps,
  parseRunMetadataOps,
  sanitizeRunMetadata,
  runMetadataByteLength,
  RunMetadataError,
  MAX_RUN_METADATA_BYTES,
} from "./runMetadata";

describe("applyRunMetadataOps (HEL-705)", () => {
  it("set / remove / replace mutate without touching the input", () => {
    const current = { a: 1, b: 2 };
    const next = applyRunMetadataOps(current, [
      { op: "set", key: "c", value: 3 },
      { op: "remove", key: "a" },
    ]);
    expect(next).toEqual({ b: 2, c: 3 });
    expect(current).toEqual({ a: 1, b: 2 }); // not mutated

    expect(applyRunMetadataOps(next, [{ op: "replace", value: { only: true } }])).toEqual({
      only: true,
    });
  });

  it("append coerces to an array and pushes", () => {
    expect(applyRunMetadataOps({}, [{ op: "append", key: "log", value: "a" }])).toEqual({
      log: ["a"],
    });
    expect(
      applyRunMetadataOps({ log: ["a"] }, [{ op: "append", key: "log", value: "b" }]),
    ).toEqual({ log: ["a", "b"] });
    // a pre-existing scalar becomes the first array element
    expect(applyRunMetadataOps({ log: "a" }, [{ op: "append", key: "log", value: "b" }])).toEqual({
      log: ["a", "b"],
    });
  });

  it("increment defaults to +1, accepts a custom (and negative) amount, treats non-numbers as 0", () => {
    expect(applyRunMetadataOps({}, [{ op: "increment", key: "n" }])).toEqual({ n: 1 });
    expect(applyRunMetadataOps({ n: 5 }, [{ op: "increment", key: "n", amount: 3 }])).toEqual({
      n: 8,
    });
    expect(applyRunMetadataOps({ n: 5 }, [{ op: "increment", key: "n", amount: -2 }])).toEqual({
      n: 3,
    });
    expect(applyRunMetadataOps({ n: "x" }, [{ op: "increment", key: "n" }])).toEqual({ n: 1 });
  });

  it("throws when the result exceeds the 256KB cap", () => {
    const big = "x".repeat(MAX_RUN_METADATA_BYTES + 10);
    expect(() => applyRunMetadataOps({}, [{ op: "set", key: "big", value: big }])).toThrow(
      RunMetadataError,
    );
  });

  it("throws on a non-finite increment amount", () => {
    expect(() =>
      applyRunMetadataOps({}, [{ op: "increment", key: "n", amount: Infinity }]),
    ).toThrow(RunMetadataError);
  });
});

describe("parseRunMetadataOps (HEL-705)", () => {
  it("accepts { ops: [...] }, a bare array, and { metadata } as a replace", () => {
    expect(parseRunMetadataOps({ ops: [{ op: "set", key: "a", value: 1 }] })).toEqual([
      { op: "set", key: "a", value: 1 },
    ]);
    expect(parseRunMetadataOps([{ op: "remove", key: "a" }])).toEqual([
      { op: "remove", key: "a" },
    ]);
    expect(parseRunMetadataOps({ metadata: { a: 1 } })).toEqual([
      { op: "replace", value: { a: 1 } },
    ]);
  });

  it("rejects malformed ops", () => {
    expect(() => parseRunMetadataOps({})).toThrow(RunMetadataError);
    expect(() => parseRunMetadataOps({ ops: [{ op: "nope", key: "a" }] })).toThrow(RunMetadataError);
    expect(() => parseRunMetadataOps({ ops: [{ op: "set" }] })).toThrow(RunMetadataError);
    expect(() => parseRunMetadataOps({ ops: [{ op: "replace", value: 5 }] })).toThrow(
      RunMetadataError,
    );
  });
});

describe("sanitizeRunMetadata (HEL-705)", () => {
  it("returns {} for absent input, copies an object, rejects non-objects + over-cap", () => {
    expect(sanitizeRunMetadata(undefined)).toEqual({});
    expect(sanitizeRunMetadata({ a: 1 })).toEqual({ a: 1 });
    expect(() => sanitizeRunMetadata("nope")).toThrow(RunMetadataError);
    expect(() => sanitizeRunMetadata([1, 2])).toThrow(RunMetadataError);
    expect(() => sanitizeRunMetadata({ big: "x".repeat(MAX_RUN_METADATA_BYTES) })).toThrow(
      RunMetadataError,
    );
  });

  it("runMetadataByteLength measures the JSON encoding", () => {
    expect(runMetadataByteLength(undefined)).toBe(2); // "{}"
    expect(runMetadataByteLength({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });
});
