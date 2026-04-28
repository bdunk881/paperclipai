import { createHash } from "crypto";

const METADATA_PREFIX = "<!--autoflow:";
const METADATA_SUFFIX = "-->";

export interface TrackerSyncMetadata {
  source: string;
  idempotencyKey: string;
}

export function buildTrackerIdempotencyKey(input: {
  provider: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  fingerprint: string;
}): string {
  const base = [
    input.provider,
    input.workspaceId,
    input.entityType,
    input.entityId,
    input.fingerprint,
  ].join(":");

  return createHash("sha256").update(base).digest("hex");
}

export function buildMirroredCommentBody(input: {
  agentName: string;
  body: string;
  metadata: TrackerSyncMetadata;
}): string {
  const metadata = `${METADATA_PREFIX}source=${input.metadata.source};idempotency=${input.metadata.idempotencyKey}${METADATA_SUFFIX}`;
  const prefixedBody = `[AutoFlow · ${input.agentName}] ${input.body.trim()}`;
  return `${metadata}\n${prefixedBody}`;
}

export function extractTrackerSyncMetadata(body: string): TrackerSyncMetadata | null {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith(METADATA_PREFIX)) {
    return null;
  }

  const endIndex = trimmed.indexOf(METADATA_SUFFIX);
  if (endIndex === -1) {
    return null;
  }

  const raw = trimmed.slice(METADATA_PREFIX.length, endIndex);
  const pairs = raw.split(";").map((part) => part.trim()).filter(Boolean);
  const data = new Map<string, string>();
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (!key || !value) {
      continue;
    }
    data.set(key, value);
  }

  const source = data.get("source");
  const idempotencyKey = data.get("idempotency");
  if (!source || !idempotencyKey) {
    return null;
  }

  return { source, idempotencyKey };
}

export function shouldSuppressEcho(body: string, idempotencyKey: string): boolean {
  const metadata = extractTrackerSyncMetadata(body);
  return metadata?.idempotencyKey === idempotencyKey;
}
