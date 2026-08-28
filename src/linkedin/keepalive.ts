import { requestRaw } from './client.js';
import { markInvalid, status as sessionStatus } from './session.js';

/**
 * Periodic session keepalive.
 *
 * Cookie rotation is driven by traffic: LinkedIn re-issues `lidc`, `li_at` and
 * `__cf_bm` on responses, so a busy service keeps itself current for free. An
 * idle one does not — and a deployment that sits untouched for a week between
 * being handed over and being opened is exactly the case that matters here.
 *
 * So we generate a small amount of traffic on purpose. Every few hours the
 * service calls `/voyager/api/me`, which does three things:
 *
 *  1. **Refreshes the jar.** The response carries `Set-Cookie`, which
 *     `client.ts` absorbs and persists, so the credential never goes stale
 *     from disuse.
 *  2. **Detects death early.** If LinkedIn has invalidated the session, this
 *     is where it surfaces — `/v1/health` flips to 503 with `invalid_since`
 *     set, hours before a real caller would have hit the failure.
 *  3. **Costs nothing that is scarce.** `/me` returns the *authenticated
 *     member's* own identity. It is not a profile view, so it does not consume
 *     the commercial use limit that caps how many distinct profiles the
 *     account may look at per month. Six requests a day against an endpoint
 *     every logged-in client calls on page load is indistinguishable from
 *     ordinary use.
 *
 * Disable with KEEPALIVE_INTERVAL_MINUTES=0.
 */

const DEFAULT_INTERVAL_MINUTES = 240;
const ENDPOINT = '/voyager/api/me';

let timer: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const raw = process.env.KEEPALIVE_INTERVAL_MINUTES;
  const minutes = raw === undefined ? DEFAULT_INTERVAL_MINUTES : Number.parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60_000;
}

export function startKeepalive(): void {
  const period = intervalMs();
  if (period === 0 || timer) return;

  // Jitter the first run so several instances started together do not all
  // ping in lockstep, and so the cadence is not perfectly periodic.
  const firstDelay = Math.floor(period * (0.1 + Math.random() * 0.2));

  setTimeout(() => {
    void ping();
    timer = setInterval(() => void ping(), period);
    // Do not hold the process open for this alone.
    timer.unref?.();
  }, firstDelay).unref?.();

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'session keepalive scheduled',
      every_minutes: period / 60_000,
      first_run_in_minutes: Math.round(firstDelay / 60_000),
    }),
  );
}

export function stopKeepalive(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function ping(): Promise<void> {
  try {
    await requestRaw(ENDPOINT, { immediate: true });
    const state = sessionStatus();
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'session keepalive ok',
        rotations: state.rotations,
        last_rotated_at: state.last_rotated_at,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A dead session must be visible on /v1/health, not just in the log.
    if (/SESSION_EXPIRED|AUTH_WALL|rejected the session/i.test(message)) markInvalid();
    console.error(JSON.stringify({ level: 'error', msg: 'session keepalive failed', error: message }));
  }
}
