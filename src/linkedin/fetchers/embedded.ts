import * as cheerio from 'cheerio';
import { ApiError } from '../../errors.js';
import { ACCEPT_HTML, requestRaw } from '../client.js';
import type { RestliEnvelope } from '../restli.js';

/**
 * Strategy: read the JSON LinkedIn ships inside its own HTML.
 *
 * The profile page is server-rendered with its data pre-fetched into
 * `<code style="display:none" id="bpr-guid-N">…</code>` blocks — the same
 * Rest.li envelopes the browser would otherwise fetch over XHR. Two blocks per
 * request: a descriptor (`{request, status, body: "bpr-guid-M"}`) and the
 * payload it points at.
 *
 * Why this is the primary strategy rather than the clever one:
 *
 *  - **No `queryId` to maintain.** The server picks the query. LinkedIn rotates
 *    GraphQL query hashes with every web release; a scraper pinned to one is
 *    always some days from breaking. This one cannot rot that way.
 *  - **The `/details/*` sub-pages give full sections.** The profile page embeds
 *    only the first few positions and skills, but `/in/<slug>/details/skills/`
 *    embeds the complete list, in the same envelope format. Full coverage, same
 *    parser, no extra API surface to reverse.
 *  - **`/overlay/contact-info/` is a real URL.** The contact-info modal is
 *    server-rendered at its own address, so it can be fetched over plain HTTP
 *    rather than driving a browser to click the link that opens it.
 *
 * The cost is bandwidth — roughly 1–3 MB of HTML per page against ~50 KB for
 * the equivalent GraphQL call — which is why the GraphQL tier stays in the
 * chain as a fast path when its query hash is known to be good.
 */

/** Sub-pages that carry the complete list for a section. */
export const DETAIL_SECTIONS = {
  experience: 'experience',
  education: 'education',
  skills: 'skills',
  certifications: 'certifications',
  languages: 'languages',
  projects: 'projects',
  honors: 'honors',
  volunteering: 'volunteering-experiences',
  publications: 'publications',
  courses: 'courses',
} as const;

export type DetailSection = keyof typeof DETAIL_SECTIONS;

export interface EmbeddedPage {
  path: string;
  html: string;
  envelopes: RestliEnvelope[];
  /** Voyager paths the page pre-fetched — useful for endpoint discovery. */
  requests: string[];
  /** GraphQL query hashes found in the page, harvested for the GraphQL tier. */
  queryIds: string[];
}

export interface EmbeddedResult {
  envelopes: RestliEnvelope[];
  requests: string[];
  queryIds: string[];
  pagesFetched: string[];
  /** Retained so the DOM fallback can reuse the HTML we already paid for. */
  pages: EmbeddedPage[];
}

export interface EmbeddedOptions {
  /** Sections to pull full lists for. Empty means the main page only. */
  sections?: DetailSection[];
  /** Fetch `/overlay/contact-info/`. Off unless the caller opted in. */
  contactInfo?: boolean;
}

export async function fetchEmbedded(
  publicIdentifier: string,
  options: EmbeddedOptions = {},
): Promise<EmbeddedResult> {
  const slug = encodeURIComponent(publicIdentifier);
  const result: EmbeddedResult = {
    envelopes: [],
    requests: [],
    queryIds: [],
    pagesFetched: [],
    pages: [],
  };

  const main = await fetchPage(`/in/${slug}/`);
  collect(result, main);

  if (result.envelopes.length === 0 && !main.html.includes('<h1')) {
    throw new ApiError('UNEXPECTED_PAYLOAD', 'Profile page contained no embedded data blocks.', {
      hint: 'LinkedIn may have served a client-rendered shell; the session may lack full access.',
    });
  }

  for (const section of options.sections ?? []) {
    const page = await fetchOptional(`/in/${slug}/details/${DETAIL_SECTIONS[section]}/`);
    if (page) collect(result, page);
  }

  if (options.contactInfo) {
    const page = await fetchOptional(`/in/${slug}/overlay/contact-info/`);
    if (page) collect(result, page);
  }

  return result;
}

/**
 * A missing section page is normal — the member simply has no entries of that
 * kind, and LinkedIn 404s rather than serving an empty list. Nothing else is
 * swallowed: a dead session or a block still propagates.
 */
async function fetchOptional(path: string): Promise<EmbeddedPage | null> {
  try {
    return await fetchPage(path);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PROFILE_NOT_FOUND') return null;
    throw err;
  }
}

async function fetchPage(path: string): Promise<EmbeddedPage> {
  const raw = await requestRaw(path, {
    accept: ACCEPT_HTML,
    referer: 'https://www.linkedin.com/feed/',
  });

  if (/authwall|<form[^>]+action="[^"]*\/uas\/login/i.test(raw.body)) {
    throw new ApiError('AUTH_WALL', 'LinkedIn served the logged-out auth wall for this profile.');
  }

  return { path, html: raw.body, ...extractEmbedded(raw.body) };
}

const QUERY_ID = /\b(voyager[A-Za-z]+\.[0-9a-f]{32})\b/g;

/**
 * Pull every embedded block out of a page and pair descriptors with payloads.
 * Exported separately from the fetch so it can be unit-tested against saved
 * HTML fixtures without touching the network.
 */
export function extractEmbedded(html: string): Omit<EmbeddedPage, 'path' | 'html'> {
  const $ = cheerio.load(html);

  const blocks = new Map<string, unknown>();
  const requests: string[] = [];
  const envelopes: RestliEnvelope[] = [];

  // cheerio's .text() decodes the HTML entities the JSON was escaped with, so
  // there is no hand-rolled unescaping to get wrong.
  $('code[id^="bpr-guid-"]').each((_, element) => {
    const id = $(element).attr('id');
    if (!id) return;
    const parsed = tryParse($(element).text());
    if (parsed !== undefined) blocks.set(id, parsed);
  });

  // Descriptors tell us which Voyager path produced which payload.
  const payloadIds = new Set<string>();
  for (const value of blocks.values()) {
    if (!isRecord(value)) continue;
    const request = value['request'];
    const bodyRef = value['body'];
    if (typeof request === 'string' && typeof bodyRef === 'string') {
      requests.push(request);
      payloadIds.add(bodyRef);
    }
  }

  for (const [id, value] of blocks.entries()) {
    if (!isRecord(value)) continue;
    // Skip descriptors themselves; keep anything that looks like an envelope.
    if ('request' in value && 'body' in value) continue;

    const looksLikeEnvelope = 'included' in value || 'data' in value || 'elements' in value;
    if (looksLikeEnvelope || payloadIds.has(id)) envelopes.push(value as RestliEnvelope);
  }

  const queryIds = [...new Set(Array.from(html.matchAll(QUERY_ID), (m) => m[1] as string))];

  return { envelopes, requests: [...new Set(requests)], queryIds };
}

function collect(target: EmbeddedResult, page: EmbeddedPage): void {
  target.envelopes.push(...page.envelopes);
  target.requests = [...new Set([...target.requests, ...page.requests])];
  target.queryIds = [...new Set([...target.queryIds, ...page.queryIds])];
  target.pagesFetched.push(page.path);
  target.pages.push(page);
}

function tryParse(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
