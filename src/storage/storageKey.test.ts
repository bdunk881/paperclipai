import {
  deriveStorageKey,
  deriveListPrefix,
  parseStorageKey,
  generateObjectId,
  sanitizeFilename,
  assertSafeSegment,
  assertValidCollection,
  assertValidRetention,
  isUuid,
  isRetentionClass,
  StorageKeyError,
  WORKSPACE_PREFIX,
  RETENTION_CLASSES,
  DEFAULT_RETENTION_CLASS,
} from "./storageKey";

const WID = "11111111-1111-4111-8111-111111111111";
const ULID_RE = "[0-9A-HJKMNP-TV-Z]{26}";

describe("storageKey", () => {
  describe("sanitizeFilename", () => {
    it("replaces unsafe characters with underscores and collapses runs", () => {
      expect(sanitizeFilename("hello world.txt")).toBe("hello_world.txt");
      expect(sanitizeFilename("My Report (v2).pdf")).toBe("My_Report_v2_.pdf");
      // Non-ASCII input via fromCharCode so this source file stays pure ASCII
      // (avoids any text-encoding ambiguity). 0xe9 is the e-acute code point.
      const eAcute = String.fromCharCode(0xe9);
      expect(sanitizeFilename(`r${eAcute}sum${eAcute}.pdf`)).toBe("r_sum_.pdf");
    });

    it("keeps only the basename (defeats path injection in the filename)", () => {
      expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
      expect(sanitizeFilename("C:\\Windows\\system32\\evil.dll")).toBe("evil.dll");
    });

    it("strips leading dots and never yields a traversal token", () => {
      expect(sanitizeFilename("...hidden")).toBe("hidden");
      expect(sanitizeFilename("..")).toBe("file");
      expect(sanitizeFilename("")).toBe("file");
    });

    it("caps very long filenames", () => {
      expect(sanitizeFilename("a".repeat(500))).toHaveLength(200);
    });
  });

  describe("generateObjectId", () => {
    it("prefixes a 26-char ULID and appends the sanitized filename", () => {
      expect(generateObjectId("hello world.txt")).toMatch(new RegExp(`^${ULID_RE}-hello_world\\.txt$`));
    });

    it("is unique across calls", () => {
      const a = generateObjectId("x.txt");
      const b = generateObjectId("x.txt");
      expect(a).not.toBe(b);
    });
  });

  describe("deriveStorageKey", () => {
    it("composes {retention}/workspaces/{wid}/{collection}/{objectId}, defaulting retention to standard", () => {
      const key = deriveStorageKey({ workspaceId: WID, collection: "run-input", objectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf" });
      expect(key).toBe(`standard/${WORKSPACE_PREFIX}/${WID}/run-input/01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf`);
    });

    it("uses the retention class as the top-level prefix (HEL-358)", () => {
      const ref = { workspaceId: WID, collection: "export", objectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV-r.csv" };
      expect(deriveStorageKey({ ...ref, retentionClass: "short" })).toBe(
        `short/${WORKSPACE_PREFIX}/${WID}/export/01ARZ3NDEKTSV4RRFFQ69G5FAV-r.csv`,
      );
      expect(deriveStorageKey({ ...ref, retentionClass: "legal_hold" })).toBe(
        `legal_hold/${WORKSPACE_PREFIX}/${WID}/export/01ARZ3NDEKTSV4RRFFQ69G5FAV-r.csv`,
      );
    });

    it("rejects an invalid retention class", () => {
      expect(() =>
        deriveStorageKey({ workspaceId: WID, collection: "export", objectId: "x", retentionClass: "forever" as never }),
      ).toThrow(StorageKeyError);
    });

    it("rejects a non-UUID workspaceId", () => {
      expect(() => deriveStorageKey({ workspaceId: "not-a-uuid", collection: "run-input", objectId: "x" })).toThrow(StorageKeyError);
    });

    it("rejects path separators / traversal in collection or objectId", () => {
      expect(() => deriveStorageKey({ workspaceId: WID, collection: "a/b", objectId: "x" })).toThrow(/path separators/);
      expect(() => deriveStorageKey({ workspaceId: WID, collection: "run-input", objectId: "a/b" })).toThrow(/path separators/);
      expect(() => deriveStorageKey({ workspaceId: WID, collection: "run-input", objectId: ".." })).toThrow(/traversal/);
      expect(() => deriveStorageKey({ workspaceId: WID, collection: "..", objectId: "x" })).toThrow();
    });

    it("rejects collections that aren't lowercase kebab tokens", () => {
      expect(() => assertValidCollection("RunInput")).toThrow(StorageKeyError);
      expect(() => assertValidCollection("with space")).toThrow();
      expect(() => assertValidCollection("ok-collection-1")).not.toThrow();
    });
  });

  describe("deriveListPrefix", () => {
    it("returns the {retention}/workspace prefix, optionally narrowed to a collection", () => {
      expect(deriveListPrefix("standard", WID)).toBe(`standard/${WORKSPACE_PREFIX}/${WID}/`);
      expect(deriveListPrefix("short", WID, "export")).toBe(`short/${WORKSPACE_PREFIX}/${WID}/export/`);
    });

    it("rejects a non-UUID workspaceId and an invalid retention class", () => {
      expect(() => deriveListPrefix("standard", "nope")).toThrow(StorageKeyError);
      expect(() => deriveListPrefix("nope" as never, WID)).toThrow(StorageKeyError);
    });
  });

  describe("parseStorageKey", () => {
    it("round-trips a derived key back into a ref (incl. retention)", () => {
      const ref = {
        workspaceId: WID,
        collection: "run-input",
        objectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf",
        retentionClass: "short" as const,
      };
      expect(parseStorageKey(deriveStorageKey(ref))).toEqual(ref);
    });

    it("parses a legacy 4-segment key as standard retention", () => {
      expect(parseStorageKey(`${WORKSPACE_PREFIX}/${WID}/run-input/01ARZ-a.pdf`)).toEqual({
        workspaceId: WID,
        collection: "run-input",
        objectId: "01ARZ-a.pdf",
        retentionClass: "standard",
      });
    });

    it("returns null for keys outside the canonical layout", () => {
      expect(parseStorageKey("foo/bar")).toBeNull();
      expect(parseStorageKey(`other/${WID}/run-input/x`)).toBeNull();
      expect(parseStorageKey(`${WORKSPACE_PREFIX}/not-a-uuid/run-input/x`)).toBeNull();
      // 5-segment but the leading segment isn't a valid retention class.
      expect(parseStorageKey(`bogus/${WORKSPACE_PREFIX}/${WID}/run-input/x`)).toBeNull();
    });
  });

  describe("retention", () => {
    it("exposes the three classes + a standard default", () => {
      expect(RETENTION_CLASSES).toEqual(["short", "standard", "legal_hold"]);
      expect(DEFAULT_RETENTION_CLASS).toBe("standard");
      expect(isRetentionClass("short")).toBe(true);
      expect(isRetentionClass("forever")).toBe(false);
    });

    it("assertValidRetention throws on unknown classes", () => {
      expect(() => assertValidRetention("nope")).toThrow(StorageKeyError);
      expect(() => assertValidRetention("legal_hold")).not.toThrow();
    });
  });

  describe("primitives", () => {
    it("isUuid validates the UUID shape", () => {
      expect(isUuid(WID)).toBe(true);
      expect(isUuid("x")).toBe(false);
    });

    it("assertSafeSegment rejects separators, NUL, and bare traversal", () => {
      expect(() => assertSafeSegment("seg", "")).toThrow();
      expect(() => assertSafeSegment("seg", "a/b")).toThrow();
      expect(() => assertSafeSegment("seg", "a\\b")).toThrow();
      expect(() => assertSafeSegment("seg", "..")).toThrow();
      // Spaces and embedded ".." are allowed at the segment level (collection
      // gets the stricter kebab check; objectId is ULID-prefixed).
      expect(() => assertSafeSegment("seg", "a b")).not.toThrow();
      expect(() => assertSafeSegment("seg", "a..b")).not.toThrow();
    });
  });
});
