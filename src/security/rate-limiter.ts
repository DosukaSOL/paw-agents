// ─── Rate Limiter ───
import { config } from '../core/config';

interface RateBucket {
  count: number;
  window_start: number;
}

const buckets = new Map<string, RateBucket>();

const WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; reset_in_ms: number } {
  const now = Date.now();
  const limit = config.security.rateLimitPerMinute;

  let bucket = buckets.get(userId);

  if (!bucket || now - bucket.window_start >= WINDOW_MS) {
    bucket = { count: 0, window_start: now };
    buckets.set(userId, bucket);
  }

  const remaining = Math.max(0, limit - bucket.count);
  const reset_in_ms = WINDOW_MS - (now - bucket.window_start);

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, reset_in_ms };
  }

  bucket.count++;
  return { allowed: true, remaining: remaining - 1, reset_in_ms };
}

// Clean up stale buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.window_start >= WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}, WINDOW_MS * 2).unref();
