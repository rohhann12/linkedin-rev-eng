/**
 * Registry of Voyager GraphQL query hashes.
 *
 * LinkedIn's GraphQL endpoint does not accept arbitrary queries. Every call
 * names a *persisted* query by id — `voyagerIdentityDashProfileCards.<md5>` —
 * and those ids are baked into the web bundle, changing whenever the relevant
 * client ships. A hash hardcoded today is dead within weeks.
 *
 * So the registry has three layers, most trusted first:
 *
 *   1. **Environment override** — set a hash you have just verified, no deploy.
 *   2. **Learned at runtime** — the embedded-HTML strategy scrapes hashes out of
 *      the page it already fetched (`extractEmbedded().queryIds`) and feeds them
 *      back here, so the GraphQL tier repairs itself as a side effect of the
 *      tier below it doing its job.
 *   3. **Seed values** — last known good, and explicitly expected to go stale.
 *
 * The consequence worth stating plainly: a stale hash degrades this strategy to
 * "skipped" and the chain falls through to embedded HTML. It never corrupts
 * output, and it never takes the service down.
 */

export type QueryName =
  | 'profileCards'
  | 'profileByVanityName'
  | 'profileContactInfo'
  | 'profileSkills';

/** Prefix each query id carries, used to recognise harvested hashes. */
const QUERY_PREFIX: Record<QueryName, string> = {
  profileCards: 'voyagerIdentityDashProfileCards',
  profileByVanityName: 'voyagerIdentityDashProfiles',
  profileContactInfo: 'voyagerIdentityDashProfiles',
  profileSkills: 'voyagerIdentityDashProfileComponents',
};

const ENV_KEYS: Record<QueryName, string> = {
  profileCards: 'LINKEDIN_QID_PROFILE_CARDS',
  profileByVanityName: 'LINKEDIN_QID_PROFILE_BY_VANITY',
  profileContactInfo: 'LINKEDIN_QID_CONTACT_INFO',
  profileSkills: 'LINKEDIN_QID_PROFILE_SKILLS',
};

/**
 * Seeds. Treat as hints, not guarantees — verify with `npm run harvest` before
 * relying on any of them.
 */
const SEEDS: Partial<Record<QueryName, string>> = {};

const learned = new Map<QueryName, string>();

export function getQueryId(name: QueryName): string | null {
  const fromEnv = process.env[ENV_KEYS[name]]?.trim();
  if (fromEnv) return qualify(name, fromEnv);

  const fromRuntime = learned.get(name);
  if (fromRuntime) return fromRuntime;

  const seed = SEEDS[name];
  return seed ? qualify(name, seed) : null;
}

/**
 * Record hashes observed in a fetched page. Only the first hash seen for a
 * prefix is kept: pages embed several, and the first is the one the page itself
 * used for its primary query.
 */
export function learnQueryIds(candidates: string[]): void {
  for (const candidate of candidates) {
    for (const [name, prefix] of Object.entries(QUERY_PREFIX) as [QueryName, string][]) {
      if (!candidate.startsWith(`${prefix}.`)) continue;
      if (!learned.has(name)) learned.set(name, candidate);
    }
  }
}

export function knownQueryIds(): Record<string, string | null> {
  return Object.fromEntries(
    (Object.keys(QUERY_PREFIX) as QueryName[]).map((name) => [name, getQueryId(name)]),
  );
}

/** Accept either a bare hash or an already-qualified `prefix.hash`. */
function qualify(name: QueryName, value: string): string {
  return value.includes('.') ? value : `${QUERY_PREFIX[name]}.${value}`;
}
