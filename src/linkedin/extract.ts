import { config } from '../config.js';
import type { StrategyName } from '../config.js';
import { ApiError, toApiError } from '../errors.js';
import { emptyProfile, profileSchema, SCHEMA_VERSION } from '../schema.js';
import type { Profile } from '../schema.js';
import { fetchEmbedded } from './fetchers/embedded.js';
import type { DetailSection, EmbeddedResult } from './fetchers/embedded.js';
import { normalizeContactDom, normalizeDom } from './fetchers/dom.js';
import { fetchGraphql } from './fetchers/graphql.js';
import {
  fetchActivity,
  fetchContactInfoRest,
  fetchPositionGroups,
  fetchRest,
} from './fetchers/rest.js';
import { normalizeDash } from './normalize/dash.js';
import { emptySections, isUsable, mergeInto } from './normalize/merge.js';
import type { Provenance } from './normalize/merge.js';
import { learnQueryIds } from './query-ids.js';
import type { ParsedProfileUrl } from './url.js';

/**
 * The extraction pipeline: run strategies in trust order, merge what each one
 * produced, and report honestly on what happened.
 *
 * The chain never stops at the first success. A strategy that returns a name
 * and headline but no certifications has not "won" — the next strategy may
 * carry the section it missed, and merging is cheap compared to a second
 * request from the caller. It stops early only when the profile is complete
 * enough that further calls would spend the session's request budget for
 * nothing.
 */

export interface ExtractOptions {
  /** Fetch full `/details/*` lists rather than the profile page's previews. */
  deep?: boolean;
  /** Opt in to the contact-info section. Off by default: it is personal data. */
  includeContact?: boolean;
  /** Opt in to the activity feed. Off by default: it costs an extra request. */
  includeActivity?: boolean;
  /** Restrict the chain, mainly for testing and for the strategy comparison. */
  only?: StrategyName[];
}

export interface StrategyReport {
  name: string;
  status: 'ok' | 'empty' | 'error' | 'skipped';
  duration_ms: number;
  error: string | null;
}

export interface ExtractResult {
  profile: Profile;
  strategies: StrategyReport[];
  provenance: Provenance;
  warnings: string[];
  partial: boolean;
}

const DEEP_SECTIONS: DetailSection[] = [
  'experience',
  'education',
  'skills',
  'certifications',
  'languages',
  'projects',
  'honors',
  'volunteering',
  'publications',
];

export async function extractProfile(
  target: ParsedProfileUrl,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const { publicIdentifier } = target;
  const profile = emptyProfile(publicIdentifier);
  const provenance: Provenance = {};
  const strategies: StrategyReport[] = [];
  const warnings: string[] = [];

  const order = (options.only ?? config.strategyOrder).filter((name) =>
    options.only ? options.only.includes(name) : true,
  );

  let lastFatal: ApiError | null = null;
  let sawAnyPayload = false;

  for (const name of order) {
    if (isComplete(profile, options)) {
      strategies.push({ name, status: 'skipped', duration_ms: 0, error: 'already satisfied' });
      continue;
    }

    const startedAt = Date.now();
    try {
      const patch = await runStrategy(name, target, options, warnings, profile.urn);

      if (!patch || Object.keys(patch).length === 0) {
        strategies.push({ name, status: 'empty', duration_ms: Date.now() - startedAt, error: null });
        continue;
      }

      sawAnyPayload = true;
      mergeInto(profile, patch, name, provenance);
      strategies.push({ name, status: 'ok', duration_ms: Date.now() - startedAt, error: null });
    } catch (err) {
      const apiError = toApiError(err);
      strategies.push({
        name,
        status: 'error',
        duration_ms: Date.now() - startedAt,
        error: `${apiError.code}: ${apiError.message}`,
      });

      // A dead session or a hard block will fail identically for every
      // remaining strategy — they all share one set of cookies. Stop.
      if (isSessionFatal(apiError)) {
        lastFatal = apiError;
        break;
      }
      if (apiError.code === 'PROFILE_NOT_FOUND') {
        lastFatal = apiError;
        break;
      }
    }
  }

  if (!sawAnyPayload) {
    throw (
      lastFatal ??
      new ApiError('ALL_STRATEGIES_FAILED', 'Every extraction strategy failed for this profile.', {
        strategies,
      })
    );
  }

  if (!isUsable(profile)) {
    // The classic out-of-network signature: a page rendered, but LinkedIn
    // withheld the member's identity.
    throw new ApiError(
      'PROFILE_NOT_VISIBLE',
      'LinkedIn returned a profile with no identifying fields. The member is likely out of ' +
        'network for this session, or the account has hit its commercial use limit.',
      { strategies },
    );
  }

  const missing = emptySections(profile);
  if (missing.length > 0) {
    warnings.push(
      `Empty sections: ${missing.join(', ')}. LinkedIn does not distinguish "member has none" ` +
        'from "not visible to this session", so an empty section is not necessarily a failure.' +
        (options.deep ? '' : ' Re-run with deep=true to fetch full section lists.'),
    );
  }
  if (lastFatal) warnings.push(`Chain stopped early: ${lastFatal.code}.`);

  const parsed = profileSchema.parse(profile);
  return {
    profile: parsed,
    strategies,
    provenance,
    warnings,
    partial: missing.length > 0 || Boolean(lastFatal),
  };
}

async function runStrategy(
  name: StrategyName,
  target: ParsedProfileUrl,
  options: ExtractOptions,
  warnings: string[],
  knownUrn: string | null,
): Promise<Partial<Profile> | null> {
  switch (name) {
    case 'embedded':
      return runEmbedded(target, options, warnings);
    case 'graphql':
      // An earlier tier has usually already resolved the URN. Re-deriving it
      // costs a request and, when the lookup query id is stale, fails outright
      // — taking the tier down with it for no reason.
      return runGraphql(target, knownUrn);
    case 'rest':
      return runRest(target, options);
    default:
      return null;
  }
}

async function runEmbedded(
  target: ParsedProfileUrl,
  options: ExtractOptions,
  warnings: string[],
): Promise<Partial<Profile>> {
  const result: EmbeddedResult = await fetchEmbedded(target.publicIdentifier, {
    sections: options.deep ? DEEP_SECTIONS : [],
    contactInfo: options.includeContact === true,
  });

  // Side benefit: the pages we just fetched carry the current GraphQL query
  // hashes, so this strategy keeps the one below it alive.
  learnQueryIds(result.queryIds);

  const patch = normalizeDash(result.envelopes, target.publicIdentifier);

  // Fall back to the DOM only where the JSON came up empty, reusing HTML we
  // have already paid for.
  if (!patch.name?.full || (patch.experience?.length ?? 0) === 0) {
    for (const page of result.pages) {
      const fromDom = normalizeDom(page.html, target.publicIdentifier);
      if (Object.keys(fromDom).length === 0) continue;
      warnings.push(`Used DOM fallback for ${page.path}; embedded JSON was incomplete.`);
      for (const [key, value] of Object.entries(fromDom)) {
        const current = (patch as Record<string, unknown>)[key];
        const isEmpty =
          current === undefined ||
          current === null ||
          (Array.isArray(current) && current.length === 0);
        if (isEmpty) (patch as Record<string, unknown>)[key] = value;
      }
    }
  }

  if (options.includeContact && !patch.contact_info) {
    const overlay = result.pages.find((page) => page.path.includes('/overlay/contact-info/'));
    if (overlay) {
      const contact = normalizeContactDom(overlay.html);
      if (contact) patch.contact_info = contact;
    }
  }

  return patch;
}

async function runGraphql(
  target: ParsedProfileUrl,
  knownUrn: string | null,
): Promise<Partial<Profile>> {
  const result = await fetchGraphql(target.publicIdentifier, knownUrn);
  return normalizeDash(result.envelopes, target.publicIdentifier);
}

async function runRest(
  target: ParsedProfileUrl,
  options: ExtractOptions,
): Promise<Partial<Profile>> {
  const result = await fetchRest(target.publicIdentifier);
  const envelopes = [...result.envelopes];

  // The main call truncates long histories. When the caller asked for depth and
  // we recovered the profile URN, the dedicated position-groups endpoint
  // returns the complete set.
  if (options.deep && result.profileUrn) {
    const groups = await fetchPositionGroups(result.profileUrn);
    envelopes.push(...groups.envelopes);
  }

  if (options.includeContact) {
    const contact = await fetchContactInfoRest(target.publicIdentifier);
    if (contact) envelopes.push(contact);
  }

  if (options.includeActivity && result.profileUrn) {
    const activity = await fetchActivity(result.profileUrn);
    envelopes.push(...activity.envelopes);
  }

  const patch = normalizeDash(envelopes, target.publicIdentifier);
  if (result.profileUrn && !patch.urn) patch.urn = result.profileUrn;
  return patch;
}

/**
 * "Complete enough to stop."
 *
 * The bar is identity plus *some* career history — deliberately not "every
 * section populated", because most sections are legitimately empty on most
 * profiles. Requiring education here meant that anyone who simply has not
 * listed a school looked permanently incomplete, so the chain ran every
 * remaining tier on every such profile. Measured against a live profile that
 * cost 2,364ms on top of a 544ms answer: 81% of the response time spent on a
 * tier that had nothing to add.
 *
 * Opt-in sections still gate, because the caller asked for them specifically.
 */
function isComplete(profile: Profile, options: ExtractOptions): boolean {
  const hasIdentity = Boolean(profile.name.full && profile.headline);
  const hasHistory = profile.experience.length > 0 || profile.education.length > 0;
  const hasContact = !options.includeContact || profile.contact_info !== null;
  const hasActivity = !options.includeActivity || profile.activity.length > 0;
  return hasIdentity && hasHistory && hasContact && hasActivity;
}

function isSessionFatal(err: ApiError): boolean {
  return (
    err.code === 'SESSION_EXPIRED' ||
    err.code === 'SESSION_MISSING' ||
    err.code === 'AUTH_WALL' ||
    err.code === 'UPSTREAM_BLOCKED'
  );
}

export { SCHEMA_VERSION };
