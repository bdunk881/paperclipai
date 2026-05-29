import { DurableObject } from "cloudflare:workers";

export interface RateLimiterConsumeRequest {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimiterConsumeResponse {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiterRefundRequest {
  key: string;
  windowMs?: number;
}

export interface RateLimiterRefundResponse {
  refunded: boolean;
}

export interface RateLimiterEnv {}

interface HitRow {
  [key: string]: SqlStorageValue;
  ts: number;
}

interface NewestHitRow extends HitRow {
  rowid: number;
}

export class RateLimiterDO extends DurableObject<RateLimiterEnv> {
  private hits: number[] | null = null;

  constructor(ctx: DurableObjectState, env: RateLimiterEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS hits (
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits (ts);
      `);
    });
  }

  async consume(input: RateLimiterConsumeRequest): Promise<RateLimiterConsumeResponse> {
    const start = Date.now();
    const result = await this.ctx.blockConcurrencyWhile(async () => {
      return this.consumeLocked(input, start);
    });

    console.log(
      JSON.stringify({
        evt: "rate_limiter_consume",
        doClass: "RateLimiterDO",
        method: "consume",
        scope: input.key.split("::", 1)[0],
        allowed: result.allowed,
        remaining: result.remaining,
        retryAfterMs: result.retryAfterMs,
        limit: input.limit,
        windowMs: input.windowMs,
        durationMs: Date.now() - start,
      }),
    );

    return result;
  }

  async refund(input: RateLimiterRefundRequest): Promise<RateLimiterRefundResponse> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (input.windowMs && input.windowMs > 0) {
        const cutoff = Date.now() - input.windowMs;
        this.ctx.storage.sql.exec("DELETE FROM hits WHERE ts <= ?", cutoff);
        if (this.hits) {
          this.hits = this.hits.filter((ts) => ts > cutoff);
        }
      }

      const newest = this.ctx.storage.sql
        .exec<NewestHitRow>("SELECT rowid, ts FROM hits ORDER BY ts DESC LIMIT 1")
        .toArray()[0];
      if (!newest) {
        return { refunded: false };
      }

      this.ctx.storage.sql.exec("DELETE FROM hits WHERE rowid = ?", newest.rowid);
      if (this.hits) {
        const index = this.hits.lastIndexOf(newest.ts);
        if (index >= 0) {
          this.hits.splice(index, 1);
        }
      }
      return { refunded: true };
    });
  }

  private consumeLocked(
    input: RateLimiterConsumeRequest,
    now: number,
  ): RateLimiterConsumeResponse {
    const cutoff = now - input.windowMs;
    this.ctx.storage.sql.exec("DELETE FROM hits WHERE ts <= ?", cutoff);

    if (this.hits === null) {
      this.hits = this.ctx.storage.sql
        .exec<HitRow>("SELECT ts FROM hits WHERE ts > ? ORDER BY ts ASC", cutoff)
        .toArray()
        .map((row) => row.ts);
    } else {
      this.hits = this.hits.filter((ts) => ts > cutoff);
    }

    if (this.hits.length >= input.limit) {
      const oldest = this.hits[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + input.windowMs - now),
      };
    }

    this.ctx.storage.sql.exec("INSERT INTO hits (ts) VALUES (?)", now);
    this.hits.push(now);

    return {
      allowed: true,
      remaining: Math.max(0, input.limit - this.hits.length),
      retryAfterMs: 0,
    };
  }
}
