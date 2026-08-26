import { config } from './config.js';

/**
 * Per-caller rate limiting: a fixed window counter keyed by API key (or client
 * IP when the service runs open in development).
 *
 * This is separate from, and complementary to, the politeness throttle in
 * `linkedin/client.ts`. That one paces requests *out* to LinkedIn to protect
 * the account; this one caps requests *in* so a single caller cannot burn the
 * whole account's daily budget in a loop.
 *
 * Fixed window rather than a token bucket on purpose: the state is one integer
 * per caller per minute, which survives the stateless function model without
 * needing shared storage to be correct. The known cost is burstiness at a
 * window boundary — acceptable for a quota measured in tens per minute.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(identity: string): RateLimitResult {
  const limit = config.rateLimitPerMinute;
  const now = Date.now();

  if (windows.size > 10_000) pruneExpired(now);

  const existing = windows.get(identity);
  const window: Window =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + WINDOW_MS };

  window.count += 1;
  windows.set(identity, window);

  return {
    allowed: window.count <= limit,
    limit,
    remaining: Math.max(0, limit - window.count),
    resetAt: window.resetAt,
  };
}

function pruneExpired(now: number): void {
  for (const [key, window] of windows.entries()) {
    if (window.resetAt <= now) windows.delete(key);
  }
}
