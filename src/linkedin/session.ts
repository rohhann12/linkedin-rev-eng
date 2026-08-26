import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { cache } from '../cache.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import {
  applySetCookies,
  csrfFrom,
  isUsable,
  parseCookieHeader,
  serializeCookieHeader,
} from './cookie-jar.js';
import type { CookieMap } from './cookie-jar.js';

/**
 * Live session state.
 *
 * The design decision here is that the session is **mutable runtime state, not
 * configuration**. A cookie header pasted into an environment variable is a
 * photograph of a session at one instant; the session itself keeps moving.
 *
 * Three mechanisms keep it current:
 *
 *  1. **Rotation.** Every Voyager response carries `Set-Cookie`. `lidc` rotates
 *     on almost every call, `li_at` periodically, `__cf_bm` every half hour.
 *     Those are merged back into the jar, so the credential we hold is always
 *     the one LinkedIn most recently issued. This is what lets a session live
 *     indefinitely without anyone re-entering a password.
 *  2. **Persistence.** The jar is written to the shared cache, so a rotated
 *     cookie survives a redeploy or an instance recycle. Without this, every
 *     cold start would fall back to the stale value baked into the environment.
 *  3. **Reseed.** `POST /v1/admin/session` replaces the jar wholesale, which is
 *     how a freshly minted session gets in without a redeploy.
 *
 * Only step 3 needs a human, and only when the session is genuinely dead —
 * password change, explicit logout, or a security checkpoint.
 */

const STORE_KEY = 'session:v1';
const STORE_TTL_SECONDS = 60 * 60 * 24 * 365;

/**
 * Disk is the authoritative store on a long-lived host.
 *
 * The in-process cache is lost on every restart, and the environment
 * deliberately holds no cookie on a deployed instance — user-data is readable
 * from the instance metadata service, so a session baked in there would sit in
 * plaintext for the life of the box. Without a file, a `systemctl restart` or a
 * reboot would leave the service authenticated-less until someone re-minted by
 * hand, which is exactly the manual step this design exists to remove.
 *
 * Written 0600 and owned by the service user. Set SESSION_FILE to relocate it,
 * or to an empty string to disable file persistence entirely (useful on
 * read-only or ephemeral filesystems, where a shared cache should be configured
 * instead).
 */
function sessionFilePath(): string | null {
  const configured = process.env.SESSION_FILE;
  if (configured === '') return null;
  return resolvePath(configured?.trim() || '.session.json');
}

export interface SessionSnapshot {
  cookieHeader: string;
  csrf: string;
}

export interface SessionStatus {
  configured: boolean;
  source: 'store' | 'env' | 'none';
  /** Names only — never values. */
  cookies: string[];
  has_li_at: boolean;
  has_csrf: boolean;
  updated_at: string | null;
  last_rotated_at: string | null;
  rotations: number;
  invalid_since: string | null;
}

interface State {
  jar: CookieMap;
  source: 'store' | 'env' | 'none';
  updatedAt: string | null;
  lastRotatedAt: string | null;
  rotations: number;
  invalidSince: string | null;
}

let state: State | null = null;
let loading: Promise<State> | null = null;

/** The cookie header and CSRF token to send with the next request. */
export async function getSession(): Promise<SessionSnapshot> {
  const current = await load();

  if (!isUsable(current.jar)) {
    throw new ApiError(
      'SESSION_MISSING',
      'No usable LinkedIn session. Set LINKEDIN_COOKIE (or LINKEDIN_LI_AT + ' +
        'LINKEDIN_JSESSIONID), or POST a fresh one to /v1/admin/session.',
    );
  }

  return { cookieHeader: serializeCookieHeader(current.jar), csrf: csrfFrom(current.jar) };
}

/**
 * Merge `Set-Cookie` from a Voyager response back into the jar.
 *
 * Deliberately fire-and-forget at the call site: rotation is a background
 * concern and a failed cache write must never fail the request that triggered
 * it. Worst case we rotate again on the next response.
 */
export async function absorbSetCookies(setCookies: string[]): Promise<void> {
  if (setCookies.length === 0) return;

  const current = await load();
  const changed = applySetCookies(current.jar, setCookies);
  if (changed.length === 0) return;

  current.lastRotatedAt = new Date().toISOString();
  current.rotations += 1;
  // A rotated cookie means LinkedIn is still talking to us.
  current.invalidSince = null;

  await persist(current);
}

/** Replace the session wholesale. Used by the admin reseed endpoint. */
export async function setSession(cookieHeader: string): Promise<SessionStatus> {
  const jar = parseCookieHeader(cookieHeader);

  if (!isUsable(jar)) {
    throw new ApiError('SESSION_MISSING', 'Cookie header must contain both li_at and JSESSIONID.', {
      received: [...jar.keys()],
    });
  }

  const next: State = {
    jar,
    source: 'store',
    updatedAt: new Date().toISOString(),
    lastRotatedAt: null,
    rotations: 0,
    invalidSince: null,
  };

  await persist(next);
  state = next;
  return status();
}

/**
 * Record that LinkedIn rejected the session. Surfaced by `/v1/health` so a
 * monitor can alert on it before callers start seeing failures.
 */
export function markInvalid(): void {
  if (state && !state.invalidSince) state.invalidSince = new Date().toISOString();
}

export function status(): SessionStatus {
  const current = state;

  if (!current) {
    return {
      configured: false,
      source: 'none',
      cookies: [],
      has_li_at: false,
      has_csrf: false,
      updated_at: null,
      last_rotated_at: null,
      rotations: 0,
      invalid_since: null,
    };
  }

  return {
    configured: isUsable(current.jar),
    source: current.source,
    cookies: [...current.jar.keys()].sort(),
    has_li_at: Boolean(current.jar.get('li_at')),
    has_csrf: Boolean(csrfFrom(current.jar)),
    updated_at: current.updatedAt,
    last_rotated_at: current.lastRotatedAt,
    rotations: current.rotations,
    invalid_since: current.invalidSince,
  };
}

/** Force a reload from the store; used by tests. */
export function resetSessionCache(): void {
  state = null;
  loading = null;
}

async function load(): Promise<State> {
  if (state) return state;
  if (loading) return loading;

  loading = (async () => {
    // Precedence: disk, then shared cache, then environment. A persisted
    // session is strictly newer than whatever was baked in at deploy time,
    // because it has been through at least one rotation.
    const fromDisk = await readFromDisk();
    if (fromDisk) {
      state = fromDisk;
      return state;
    }

    const stored = await cache().get<{ cookieHeader: string; updatedAt: string }>(STORE_KEY);

    if (stored?.value?.cookieHeader) {
      const jar = parseCookieHeader(stored.value.cookieHeader);
      if (isUsable(jar)) {
        state = {
          jar,
          source: 'store',
          updatedAt: stored.value.updatedAt,
          lastRotatedAt: null,
          rotations: 0,
          invalidSince: null,
        };
        return state;
      }
    }

    const fromEnv = config.linkedInCookie;
    const jar = parseCookieHeader(fromEnv);

    state = {
      jar,
      source: isUsable(jar) ? 'env' : 'none',
      updatedAt: null,
      lastRotatedAt: null,
      rotations: 0,
      invalidSince: null,
    };
    return state;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function persist(next: State): Promise<void> {
  next.updatedAt = new Date().toISOString();
  next.source = 'store';
  state = next;

  const record = { cookieHeader: serializeCookieHeader(next.jar), updatedAt: next.updatedAt };

  // Both backends, independently: a cache outage must not cost us the session,
  // and a read-only filesystem must not either.
  await Promise.allSettled([
    cache().set(STORE_KEY, record, STORE_TTL_SECONDS),
    writeToDisk(record),
  ]);
}

async function readFromDisk(): Promise<State | null> {
  const path = sessionFilePath();
  if (!path) return null;

  try {
    const raw = await readFile(path, 'utf8');
    const record = JSON.parse(raw) as { cookieHeader?: string; updatedAt?: string };
    if (!record.cookieHeader) return null;

    const jar = parseCookieHeader(record.cookieHeader);
    if (!isUsable(jar)) return null;

    return {
      jar,
      source: 'store',
      updatedAt: record.updatedAt ?? null,
      lastRotatedAt: null,
      rotations: 0,
      invalidSince: null,
    };
  } catch {
    // Absent or unreadable is the normal first-boot case, not an error.
    return null;
  }
}

async function writeToDisk(record: { cookieHeader: string; updatedAt: string }): Promise<void> {
  const path = sessionFilePath();
  if (!path) return;

  // Write-then-rename so a crash mid-write cannot truncate a working session
  // into an unusable one. 0600 because this file is a live credential.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, path);
}
