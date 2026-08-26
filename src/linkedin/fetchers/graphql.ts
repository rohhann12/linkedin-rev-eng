import { ApiError } from '../../errors.js';
import { ACCEPT_GRAPHQL, requestJson } from '../client.js';
import { getQueryId } from '../query-ids.js';
import type { RestliEnvelope } from '../restli.js';

/**
 * Strategy: LinkedIn's Voyager GraphQL endpoint.
 *
 * Fast and compact — tens of kilobytes against the megabytes the HTML strategy
 * moves — but it depends on a persisted query hash that LinkedIn rotates (see
 * `query-ids.ts`). It is therefore the *optimisation*, not the foundation: when
 * the hash is good this tier answers first and the chain stops; when it is
 * stale the tier reports `skipped` and costs nothing.
 *
 * Note the argument encoding. Voyager uses Rest.li's URL syntax, not JSON:
 * `variables=(profileUrn:urn%3Ali%3Afsd_profile%3AACoAAA…)`, with parentheses
 * for objects, `List(a,b)` for arrays, and colons for assignment. Encoding it
 * as JSON returns a 400 every time.
 */

export interface GraphqlResult {
  envelopes: RestliEnvelope[];
  queriesUsed: string[];
}

export async function fetchGraphql(
  publicIdentifier: string,
  profileUrn: string | null,
): Promise<GraphqlResult> {
  const result: GraphqlResult = { envelopes: [], queriesUsed: [] };

  const urn = profileUrn ?? (await resolveProfileUrn(publicIdentifier, result));
  if (!urn) {
    throw new ApiError('UNEXPECTED_PAYLOAD', 'Could not resolve a profile URN for the GraphQL tier.');
  }

  const cardsQuery = getQueryId('profileCards');
  if (!cardsQuery) {
    throw new ApiError('UNEXPECTED_PAYLOAD', 'No GraphQL query id available for profile cards.', {
      hint: 'Run `npm run harvest` or set LINKEDIN_QID_PROFILE_CARDS.',
    });
  }

  const envelope = await callGraphql(cardsQuery, {
    profileUrn: urn,
    sectionType: 'ALL',
    locale: 'en_US',
  });

  result.envelopes.push(envelope);
  result.queriesUsed.push(cardsQuery);
  return result;
}

/**
 * Vanity slug → `urn:li:fsd_profile:…`. The GraphQL profile queries key on the
 * URN, but a caller only ever has the slug from the URL they pasted.
 */
export async function resolveProfileUrn(
  publicIdentifier: string,
  sink?: GraphqlResult,
): Promise<string | null> {
  const query = getQueryId('profileByVanityName');
  if (!query) return null;

  const envelope = await callGraphql(query, { vanityName: publicIdentifier });
  sink?.envelopes.push(envelope);
  sink?.queriesUsed.push(query);

  return findProfileUrn(envelope);
}

/** Fetch the contact-info card by URN. Opt-in only; see `contact.ts`. */
export async function fetchContactInfoGraphql(profileUrn: string): Promise<RestliEnvelope | null> {
  const query = getQueryId('profileContactInfo');
  if (!query) return null;
  return callGraphql(query, { profileUrn, locale: 'en_US' });
}

async function callGraphql(
  queryId: string,
  variables: Record<string, string>,
): Promise<RestliEnvelope> {
  const path =
    `/voyager/api/graphql?includeWebMetadata=true` +
    `&variables=${encodeRestliArgs(variables)}` +
    `&queryId=${encodeURIComponent(queryId)}`;

  return requestJson<RestliEnvelope>(path, {
    accept: ACCEPT_GRAPHQL,
    referer: 'https://www.linkedin.com/in/',
  });
}

/**
 * Rest.li argument encoding: `(key:value,key2:value2)`. Values are
 * percent-encoded individually — notably the colons inside a URN must be
 * escaped or Voyager reads them as separators.
 */
export function encodeRestliArgs(args: Record<string, string>): string {
  const body = Object.entries(args)
    .map(([key, value]) => `${key}:${encodeURIComponent(value)}`)
    .join(',');
  return `(${body})`;
}

function findProfileUrn(envelope: RestliEnvelope): string | null {
  const included = Array.isArray(envelope.included) ? envelope.included : [];

  for (const entity of included) {
    const urn = entity.entityUrn;
    if (typeof urn === 'string' && urn.startsWith('urn:li:fsd_profile:')) return urn;
  }

  // Fall back to a scan of the whole document.
  const match = /urn:li:fsd_profile:[A-Za-z0-9_-]+/.exec(JSON.stringify(envelope));
  return match?.[0] ?? null;
}
