import { ApiError } from '../errors.js';

export interface ParsedProfileUrl {
  /** The vanity slug or opaque id used as the profile's public identifier. */
  publicIdentifier: string;
  /** Normalised canonical form we echo back and use as the cache key. */
  canonicalUrl: string;
  /**
   * `opaque` identifiers (ACoAAA…) are member-id encodings LinkedIn hands out
   * when a member has no public vanity name. They resolve on the same
   * endpoints but never appear in search results.
   */
  kind: 'vanity' | 'opaque';
}

/** Paths that are LinkedIn URLs but not member profiles. */
const NON_PROFILE_SEGMENTS = new Set([
  'company',
  'school',
  'showcase',
  'jobs',
  'posts',
  'feed',
  'groups',
  'learning',
  'events',
  'newsletters',
  'pulse',
  'services',
  'talent',
  'sales',
  'recruiter',
]);

const HOST_PATTERN = /(^|\.)linkedin\.(com|cn)$/i;
const SLUG_PATTERN = /^[\w\-%.À-￿]{1,120}$/u;
const OPAQUE_PATTERN = /^AC[o|w]A[A-Za-z0-9_-]{10,}$/;

/**
 * Accepts anything a user might paste — a full profile URL, a mobile or
 * country-subdomain URL, a legacy `/pub/` URL, or a bare slug — and reduces it
 * to the public identifier the Voyager endpoints key on.
 */
export function parseProfileUrl(input: string): ParsedProfileUrl {
  const raw = input?.trim();
  if (!raw) {
    throw new ApiError('INVALID_URL', 'No LinkedIn profile URL supplied.');
  }

  const slug = extractSlug(raw);

  if (!SLUG_PATTERN.test(slug)) {
    throw new ApiError('INVALID_URL', `"${input}" does not contain a usable profile identifier.`, {
      extracted: slug,
    });
  }

  const decoded = safeDecode(slug).replace(/\/+$/, '');
  const kind: ParsedProfileUrl['kind'] = OPAQUE_PATTERN.test(decoded) ? 'opaque' : 'vanity';

  return {
    publicIdentifier: decoded,
    canonicalUrl: `https://www.linkedin.com/in/${encodeURIComponent(decoded)}/`,
    kind,
  };
}

function extractSlug(raw: string): string {
  // A bare slug, with or without a leading `in/`.
  if (!raw.includes('/') || /^in\/[^/]+\/?$/i.test(raw)) {
    return raw.replace(/^in\//i, '').replace(/\/+$/, '');
  }

  const url = toUrl(raw);

  if (!HOST_PATTERN.test(url.hostname)) {
    throw new ApiError('INVALID_URL', `"${url.hostname}" is not a LinkedIn host.`);
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (!first) {
    throw new ApiError('INVALID_URL', 'URL has no path; expected /in/<identifier>.');
  }

  if (NON_PROFILE_SEGMENTS.has(first)) {
    throw new ApiError('INVALID_URL', `/${first}/ URLs are not member profiles.`, {
      hint: 'This API resolves member profiles only (linkedin.com/in/...).',
    });
  }

  // Modern form: /in/<slug>[/details/...]
  if (first === 'in') {
    const slug = segments[1];
    if (!slug) throw new ApiError('INVALID_URL', 'Profile URL is missing its identifier.');
    return slug;
  }

  // Legacy form: /pub/<first-last>/<a>/<b>/<c>
  if (first === 'pub') {
    const slug = segments[1];
    if (!slug) throw new ApiError('INVALID_URL', 'Legacy /pub/ URL is missing its identifier.');
    return slug;
  }

  throw new ApiError('INVALID_URL', `Unrecognised LinkedIn path "/${segments.join('/')}".`, {
    hint: 'Expected linkedin.com/in/<identifier>.',
  });
}

function toUrl(raw: string): URL {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new ApiError('INVALID_URL', `"${raw}" is not a parseable URL.`);
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
