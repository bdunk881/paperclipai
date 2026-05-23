import { randomUUID } from "crypto";
import { getRedisClient } from "../queue/redisClient";
import { EmailAuthSessionRecord, getSessionTtlSeconds } from "./emailAuthConfig";
import { getSupabaseServiceClient, sessionRecordFromSupabaseSession } from "./supabaseServiceClient";

const REDIS_KEY_PREFIX = "autoflow:auth-session:";
const memorySessions = new Map<string, EmailAuthSessionRecord>();

function redisKey(sessionId: string): string {
  return `${REDIS_KEY_PREFIX}${sessionId}`;
}

async function persistSession(sessionId: string, record: EmailAuthSessionRecord): Promise<void> {
  const ttl = getSessionTtlSeconds();
  const payload = JSON.stringify(record);

  const redis = getRedisClient();
  if (redis) {
    await redis.set(redisKey(sessionId), payload, "EX", ttl);
  } else {
    memorySessions.set(sessionId, record);
  }
}

export async function saveEmailAuthSession(record: EmailAuthSessionRecord): Promise<string> {
  const sessionId = randomUUID();
  await persistSession(sessionId, record);
  return sessionId;
}

export async function updateEmailAuthSession(
  sessionId: string,
  record: EmailAuthSessionRecord,
): Promise<void> {
  await persistSession(sessionId, record);
}

export async function loadEmailAuthSession(sessionId: string): Promise<EmailAuthSessionRecord | null> {
  const redis = getRedisClient();
  if (redis) {
    const raw = await redis.get(redisKey(sessionId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as EmailAuthSessionRecord;
    } catch {
      return null;
    }
  }

  return memorySessions.get(sessionId) ?? null;
}

export async function deleteEmailAuthSession(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.del(redisKey(sessionId));
    return;
  }

  memorySessions.delete(sessionId);
}

export async function refreshEmailAuthSession(
  record: EmailAuthSessionRecord,
): Promise<EmailAuthSessionRecord | null> {
  const client = getSupabaseServiceClient();
  if (!client || !record.refreshToken) {
    return null;
  }

  const { data, error } = await client.auth.refreshSession({ refresh_token: record.refreshToken });
  if (error || !data.session) {
    return null;
  }

  return sessionRecordFromSupabaseSession(data.session);
}

export function resetEmailAuthSessionStoreForTests(): void {
  memorySessions.clear();
}
