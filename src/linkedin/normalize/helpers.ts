import type { ProfileDate, ProfileImage } from '../../schema.js';

/**
 * Field-reading helpers shared by the normalisers.
 *
 * These are deliberately tolerant. LinkedIn ships several generations of shape
 * simultaneously — legacy `timePeriod` next to dash `dateRange`, bare strings
 * next to `TextViewModel` wrappers, images as `VectorImage` under two different
 * keys — and which one you get depends on the endpoint and the A/B bucket the
 * session lands in. Reading by "try these candidate keys" rather than by a
 * fixed path is what keeps one payload change from emptying a whole section.
 */

export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First candidate key holding a non-empty string. */
export function str(source: unknown, ...keys: string[]): string | null {
  if (!isObj(source)) return null;

  for (const key of keys) {
    const value = source[key];
    const text = asText(value);
    if (text) return text;
  }

  return null;
}

/**
 * Unwraps LinkedIn's text containers. A caption may arrive as `"Google"`, as
 * `{ text: "Google" }`, or as a `TextViewModel`
 * (`{ text: "Google", attributesV2: [...] }`) — sometimes nested twice.
 */
export function asText(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);

  if (isObj(value)) {
    for (const key of ['text', 'textDirection', 'localized', 'value', 'name']) {
      if (key in value) {
        const inner = asText(value[key], depth + 1);
        if (inner) return inner;
      }
    }
    // Multi-locale wrappers: { "en_US": "Google" }
    const first = Object.values(value).find((v) => typeof v === 'string') as string | undefined;
    if (first) return first.trim() || null;
  }

  return null;
}

export function num(source: unknown, ...keys: string[]): number | null {
  if (!isObj(source)) return null;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

export function bool(source: unknown, ...keys: string[]): boolean | null {
  if (!isObj(source)) return null;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }

  return null;
}

/** `{ year, month, day }` from either a dash or legacy date object. */
export function date(value: unknown): ProfileDate {
  if (!isObj(value)) return null;

  const year = num(value, 'year');
  const month = num(value, 'month');
  const day = num(value, 'day');

  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

export interface Range {
  start: ProfileDate;
  end: ProfileDate;
  isCurrent: boolean;
}

/**
 * Reads a period from `dateRange` (dash) or `timePeriod` (legacy). An absent
 * end date on a present start date means "current" in both generations.
 */
export function range(source: unknown): Range {
  const container =
    (isObj(source) && (source['dateRange'] ?? source['timePeriod'] ?? source['datesRange'])) ||
    source;

  if (!isObj(container)) return { start: null, end: null, isCurrent: false };

  const start = date(container['start'] ?? container['startDate']);
  const end = date(container['end'] ?? container['endDate']);

  return { start, end, isCurrent: Boolean(start) && !end };
}

/**
 * Render a span the way LinkedIn's own UI does — "2 yrs 3 mos".
 *
 * The dash payload carries `dateRange` but not the rendered duration string,
 * so this is computed rather than read. An open-ended range is measured to
 * today, matching what a viewer sees on the page.
 *
 * Returns null without a start month: a year alone cannot give a month count,
 * and inventing one would put a fabricated precision into the output.
 */
export function duration(start: ProfileDate, end: ProfileDate, now = new Date()): string | null {
  if (!start?.year || !start.month) return null;

  const endYear = end?.year ?? now.getUTCFullYear();
  const endMonth = end?.year ? (end.month ?? start.month) : now.getUTCMonth() + 1;

  let months = (endYear - start.year) * 12 + (endMonth - start.month);
  // LinkedIn counts inclusively: Jan–Jan reads as "1 mo", not "0 mos".
  months += 1;
  if (months <= 0) return null;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const parts: string[] = [];

  if (years > 0) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (remainder > 0) parts.push(`${remainder} mo${remainder === 1 ? '' : 's'}`);

  return parts.join(' ') || null;
}

const VECTOR_KEYS = [
  'vectorImage',
  'com.linkedin.common.VectorImage',
  'com.linkedin.voyager.common.VectorImage',
];

/**
 * Rebuilds absolute image URLs from a `VectorImage`. LinkedIn stores a
 * `rootUrl` plus one `artifact` per rendered size; the caller usually wants the
 * largest, so we return all sizes sorted descending by width.
 */
export function images(node: unknown, depth = 0): ProfileImage[] {
  if (depth > 6 || !isObj(node)) return [];

  const vector = findVectorImage(node, 0);
  if (!vector) return [];

  const rootUrl = typeof vector['rootUrl'] === 'string' ? vector['rootUrl'] : '';
  const artifacts = Array.isArray(vector['artifacts']) ? vector['artifacts'] : [];
  const out: ProfileImage[] = [];

  for (const artifact of artifacts) {
    if (!isObj(artifact)) continue;
    const segment = artifact['fileIdentifyingUrlPathSegment'];
    if (typeof segment !== 'string') continue;

    out.push({
      url: segment.startsWith('http') ? segment : `${rootUrl}${segment}`,
      width: num(artifact, 'width', 'expiresAt') ?? null,
      height: num(artifact, 'height') ?? null,
    });
  }

  // Some payloads carry a single pre-built URL instead of artifacts.
  if (out.length === 0) {
    const direct = str(vector, 'url', 'rootUrl');
    if (direct?.startsWith('http')) out.push({ url: direct, width: null, height: null });
  }

  return out.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
}

function findVectorImage(node: unknown, depth: number): Obj | null {
  if (depth > 6 || !isObj(node)) return null;

  for (const key of VECTOR_KEYS) {
    const candidate = node[key];
    if (isObj(candidate) && ('artifacts' in candidate || 'rootUrl' in candidate)) return candidate;
  }

  if ('artifacts' in node && 'rootUrl' in node) return node;

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findVectorImage(item, depth + 1);
        if (found) return found;
      }
      continue;
    }
    const found = findVectorImage(value, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * Splits LinkedIn's single location string into parts. It is a display string
 * with no schema — "Bengaluru, Karnataka, India" and "Greater London, United
 * Kingdom" are both valid — so we keep `raw` authoritative and treat the split
 * as a best-effort convenience.
 */
export function splitLocation(raw: string | null): { city: string | null; country: string | null } {
  if (!raw) return { city: null, country: null };

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: null, country: parts[0] ?? null };

  return { city: parts[0] ?? null, country: parts[parts.length - 1] ?? null };
}

/** Drop entries that carry no information at all. */
export function compact<T extends Obj>(rows: T[], keys: (keyof T)[]): T[] {
  return rows.filter((row) => keys.some((key) => row[key] !== null && row[key] !== undefined));
}

/** Stable de-duplication by a derived key, first occurrence wins. */
export function dedupe<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}
