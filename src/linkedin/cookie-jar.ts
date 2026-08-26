/**
 * A minimal cookie jar.
 *
 * The point of this file is rotation. LinkedIn re-issues cookies constantly on
 * ordinary responses — `lidc` (the datacenter routing cookie) on almost every
 * call, `li_at` periodically, and Cloudflare's `__cf_bm` every half hour. A
 * client that sends a frozen snapshot of the cookies it was given eventually
 * drifts out of sync and starts collecting checkpoints.
 *
 * So instead of treating the cookie header as configuration, we treat it as
 * mutable state: parse what we hold, merge in whatever `Set-Cookie` arrives,
 * and persist the result. A session maintained this way survives indefinitely
 * without anyone re-entering a password.
 */

export type CookieMap = Map<string, string>;

/** Cookies that carry no session meaning and only bloat the header. */
const IGNORED = new Set(['', 'expires', 'path', 'domain', 'max-age', 'samesite', 'secure', 'httponly']);

/** Parse a `Cookie:` request header into name → value. */
export function parseCookieHeader(header: string): CookieMap {
  const jar: CookieMap = new Map();

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || IGNORED.has(name.toLowerCase())) continue;

    jar.set(name, value);
  }

  return jar;
}

/**
 * Merge `Set-Cookie` response headers into the jar.
 *
 * Only the first `name=value` pair of each directive matters; the attributes
 * after it (Path, Expires, HttpOnly…) describe browser behaviour we are not
 * emulating. A directive with an empty value or an expiry in the past is a
 * deletion, and is applied as one.
 */
export function applySetCookies(jar: CookieMap, setCookies: string[]): string[] {
  const changed: string[] = [];

  for (const directive of setCookies) {
    const [pair = '', ...attributes] = directive.split(';');
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name || IGNORED.has(name.toLowerCase())) continue;

    if (isDeletion(value, attributes)) {
      if (jar.delete(name)) changed.push(name);
      continue;
    }

    if (jar.get(name) !== value) {
      jar.set(name, value);
      changed.push(name);
    }
  }

  return changed;
}

function isDeletion(value: string, attributes: string[]): boolean {
  if (value === '' || value === '""') return true;

  for (const attribute of attributes) {
    const [key = '', raw = ''] = attribute.split('=');
    if (key.trim().toLowerCase() !== 'expires') continue;

    const expiry = Date.parse(raw.trim());
    if (Number.isFinite(expiry) && expiry < Date.now()) return true;
  }

  return false;
}

/** Serialise back into a `Cookie:` header. */
export function serializeCookieHeader(jar: CookieMap): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * The CSRF token is the JSESSIONID value with its surrounding quotes stripped.
 * Voyager rejects any request where the two disagree, so this is derived from
 * the jar rather than stored separately — they cannot drift apart that way.
 */
export function csrfFrom(jar: CookieMap): string {
  const raw = jar.get('JSESSIONID') ?? '';
  return raw.replace(/^"+|"+$/g, '');
}

/** A jar is usable if it can authenticate and pass the CSRF check. */
export function isUsable(jar: CookieMap): boolean {
  return Boolean(jar.get('li_at')) && Boolean(csrfFrom(jar));
}
