import { ApiError } from '../../errors.js';
import { requestJson } from '../client.js';
import type { RestliEnvelope } from '../restli.js';

/**
 * Primary strategy: the Voyager dash REST collection.
 *
 * Verified live on 2026-08-26. One call returns ~68 KB containing the profile,
 * every position and position group, education, projects, skills, the Featured
 * treasury media, and the companies and schools they reference — all in the
 * normalised envelope the dash normaliser reads.
 *
 * This is first in the chain, and the reasoning is worth recording because the
 * obvious answers are both wrong:
 *
 *  - **Not the profile page's embedded JSON.** LinkedIn's flagship web app is
 *    now React Server Components with server-driven UI. Profile load issues no
 *    data API calls at all — it posts to `/flagship-web/rsc-action/...` and gets
 *    back RSC flight payloads wrapping SDUI component trees, with hashed class
 *    names and no stable field names. Parsing that means walking a serialised
 *    UI tree that changes shape on every deploy.
 *  - **Not GraphQL.** It 500s unless `queryId` is an exact current build hash,
 *    and those rotate per deploy.
 *
 * The legacy REST surface, meanwhile, is still live and still returns clean
 * JSON. It is the least fashionable target and by a distance the best one.
 *
 * `profileView` — the classic single-call endpoint every tutorial reaches for —
 * is **410 Gone**. It is not attempted.
 */

/**
 * Decoration ids carry a schema version suffix that drifts. When LinkedIn bumps
 * it the old value 400s, so each candidate is tried in turn rather than pinning
 * one and waiting for it to break. The first is the version observed live.
 */
const PROFILE_DECORATIONS = [
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-102',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-100',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-99',
];

const POSITION_GROUP_DECORATIONS = [
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfilePositionGroup-73',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfilePositionGroup-74',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfilePositionGroup-72',
];

export interface RestResult {
  envelopes: RestliEnvelope[];
  endpointsUsed: string[];
  /** Resolved from the payload; the paginated endpoints are keyed on it. */
  profileUrn: string | null;
}

export async function fetchRest(publicIdentifier: string): Promise<RestResult> {
  const slug = encodeURIComponent(publicIdentifier);
  const result: RestResult = { envelopes: [], endpointsUsed: [], profileUrn: null };

  const envelope = await firstWorkingDecoration(
    PROFILE_DECORATIONS,
    (decoration) =>
      `/voyager/api/identity/dash/profiles?q=memberIdentity` +
      `&memberIdentity=${slug}&decorationId=${encodeURIComponent(decoration)}`,
    result,
  );

  if (!envelope) {
    throw new ApiError(
      'UNEXPECTED_PAYLOAD',
      'The dash profiles endpoint rejected every known decoration version.',
      { hint: 'Read the current decorationId off a live request and set it in PROFILE_DECORATIONS.' },
    );
  }

  result.envelopes.push(envelope);
  result.profileUrn = findProfileUrn(envelope);
  return result;
}

/**
 * Dedicated, paginated experience endpoint. The main profile call already
 * carries positions, but it truncates; this returns the full set, grouped the
 * way LinkedIn renders them (one PositionGroup per company, with each role
 * nested under it).
 */
export async function fetchPositionGroups(profileUrn: string): Promise<RestResult> {
  const result: RestResult = { envelopes: [], endpointsUsed: [], profileUrn };

  const envelope = await firstWorkingDecoration(
    POSITION_GROUP_DECORATIONS,
    (decoration) =>
      `/voyager/api/identity/dash/profilePositionGroups?q=viewee` +
      `&profileUrn=${encodeURIComponent(profileUrn)}` +
      `&decorationId=${encodeURIComponent(decoration)}`,
    result,
  );

  if (envelope) result.envelopes.push(envelope);
  return result;
}

/**
 * Recent activity: posts, reposts and comments.
 *
 * Two details that are easy to get wrong. `header.text.text` reads
 * "<name> reposted this" and is the only reliable way to tell a repost from an
 * original — `actor.name.text` is the *original* author on a repost, not the
 * profile owner. And `numLikes`/`numComments` must be at least 1: passing 0
 * makes the server omit the SocialActivityCounts entities entirely, so every
 * engagement count reads null.
 */
export async function fetchActivity(profileUrn: string, count = 10): Promise<RestResult> {
  const result: RestResult = { envelopes: [], endpointsUsed: [], profileUrn };

  const path =
    `/voyager/api/identity/profileUpdatesV2?count=${count}&start=0` +
    `&includeLongTermHistory=true&moduleKey=member-shares%3Aphone` +
    `&numComments=1&numLikes=1` +
    `&profileUrn=${encodeURIComponent(profileUrn)}&q=memberShareFeed`;

  try {
    result.envelopes.push(await requestJson<RestliEnvelope>(path));
    result.endpointsUsed.push(path);
  } catch (err) {
    if (err instanceof ApiError && isFatal(err)) throw err;
  }

  return result;
}

/**
 * Contact-info hydration — the endpoint behind the profile page's "Contact
 * info" overlay, and the LinkedIn-native half of what data-enrichment vendors
 * sell.
 *
 * Worth being precise about its reach, because it is routinely overstated:
 * `emailAddress` is returned only when the member chose to share it *and* the
 * authenticated session is a 1st-degree connection. For everyone else this
 * comes back with websites and maybe a Twitter handle. Vendors that claim broad
 * email coverage are not getting it here — they take the employer and full name
 * this endpoint's neighbours provide, infer `first.last@company.com`, and
 * verify the guess over SMTP.
 */
export async function fetchContactInfoRest(
  publicIdentifier: string,
): Promise<RestliEnvelope | null> {
  const slug = encodeURIComponent(publicIdentifier);
  const path = `/voyager/api/identity/profiles/${slug}/profileContactInfo`;

  try {
    return await requestJson<RestliEnvelope>(path);
  } catch (err) {
    if (err instanceof ApiError && isFatal(err)) throw err;
    return null;
  }
}

async function firstWorkingDecoration(
  decorations: string[],
  toPath: (decoration: string) => string,
  result: RestResult,
): Promise<RestliEnvelope | null> {
  for (const decoration of decorations) {
    const path = toPath(decoration);
    try {
      const envelope = await requestJson<RestliEnvelope>(path);
      result.endpointsUsed.push(path);
      return envelope;
    } catch (err) {
      // A stale decoration version 400s; anything session-level must not be
      // retried against the next candidate.
      if (err instanceof ApiError && isFatal(err)) throw err;
    }
  }

  return null;
}

function findProfileUrn(envelope: RestliEnvelope): string | null {
  const data = envelope.data as Record<string, unknown> | undefined;
  const pointer = data?.['*elements'];

  if (Array.isArray(pointer) && typeof pointer[0] === 'string') return pointer[0];

  const included = Array.isArray(envelope.included) ? envelope.included : [];
  for (const entity of included) {
    if (typeof entity.entityUrn === 'string' && entity.entityUrn.startsWith('urn:li:fsd_profile:')) {
      return entity.entityUrn;
    }
  }

  return null;
}

/** Errors that mean "stop", not "try the next endpoint". */
function isFatal(err: ApiError): boolean {
  return (
    err.code === 'SESSION_EXPIRED' ||
    err.code === 'AUTH_WALL' ||
    err.code === 'UPSTREAM_BLOCKED' ||
    err.code === 'PROFILE_NOT_FOUND'
  );
}
