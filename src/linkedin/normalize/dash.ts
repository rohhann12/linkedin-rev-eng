import type {
  Activity,
  CompanyRef,
  ContactInfo,
  Education,
  Experience,
  Featured,
  Profile,
  ProfileImage,
} from '../../schema.js';
import { buildIndex, entitiesOfType, entitiesOfUrnType, resolve, urnId } from '../restli.js';
import type { EntityIndex, RestliEntity, RestliEnvelope } from '../restli.js';
import {
  asText,
  bool,
  compact,
  date,
  dedupe,
  duration,
  images,
  isObj,
  num,
  range,
  splitLocation,
  str,
} from './helpers.js';
import type { Obj } from './helpers.js';

/**
 * Normaliser for LinkedIn's current ("dash") entity model.
 *
 * The strategy here is to ignore the query skeleton entirely and read straight
 * from the entity pool, keyed by URN type. A profile payload contains
 * `urn:li:fsd_profilePosition:*` entries whether it arrived from the GraphQL
 * profile-cards query, from a dash REST call, or from the JSON embedded in the
 * profile page's HTML — the three transports differ, the entities do not.
 *
 * That is what lets one normaliser serve all three strategies, and why a
 * rotated GraphQL `queryId` degrades coverage rather than breaking parsing.
 */
/**
 * Select entities two ways and union the results.
 *
 * Which identifier actually works depends on the endpoint. The dash REST
 * collection tags entities with a `$type` of
 * `com.linkedin.voyager.dash.identity.profile.Position`, while GraphQL payloads
 * key the same records under `urn:li:fsd_profilePosition:…`. Matching on only
 * one of the two produces the worst possible failure: a clean 200, a valid
 * schema, and every section silently empty.
 *
 * Verified against a live session on 2026-08-26: the `$type` form is what the
 * `FullProfileWithEntities` decoration returns.
 */
function select(index: EntityIndex, typeSuffix: string, urnType: string): RestliEntity[] {
  const byType = entitiesOfType(index, typeSuffix);
  const byUrn = entitiesOfUrnType(index, urnType);
  if (byType.length === 0) return byUrn;
  if (byUrn.length === 0) return byType;

  const seen = new Set(byType.map((entity) => entity.entityUrn));
  return [...byType, ...byUrn.filter((entity) => !seen.has(entity.entityUrn))];
}

export function normalizeDash(
  envelopes: RestliEnvelope | RestliEnvelope[],
  publicIdentifier: string,
): Partial<Profile> {
  const index = buildIndex(envelopes);
  if (index.size === 0) return {};

  const core = readCoreProfile(index, publicIdentifier);
  const experience = readExperience(index);

  const out: Partial<Profile> = {
    ...core,
    ...(experience.length > 0 ? { experience } : {}),
  };

  const education = readEducation(index);
  if (education.length > 0) out.education = education;

  const skills = readSkills(index);
  if (skills.length > 0) out.skills = skills;

  const certifications = readCertifications(index);
  if (certifications.length > 0) out.certifications = certifications;

  const languages = readLanguages(index);
  if (languages.length > 0) out.languages = languages;

  const projects = readProjects(index);
  if (projects.length > 0) out.projects = projects;

  const honors = readHonors(index);
  if (honors.length > 0) out.honors = honors;

  const volunteering = readVolunteering(index);
  if (volunteering.length > 0) out.volunteering = volunteering;

  const publications = readPublications(index);
  if (publications.length > 0) out.publications = publications;

  const featured = readFeatured(index);
  if (featured.length > 0) out.featured = featured;

  const activity = readActivity(index);
  if (activity.length > 0) out.activity = activity;

  const contact = readContactInfo(index);
  if (contact) out.contact_info = contact;

  const counts = readCounts(index);
  Object.assign(out, counts);

  // Derive the headline employer from the current position when the profile
  // entity itself did not carry one.
  if (!out.current_company) {
    const current = experience.find((row) => row.is_current) ?? experience[0];
    if (current?.company.name) out.current_company = current.company;
  }

  return out;
}

/**
 * A payload usually contains several `fsd_profile` entities — the target, the
 * session's own member, and anyone referenced by a recommendation. We pick by
 * matching `publicIdentifier`, falling back to whichever entity is richest.
 */
function readCoreProfile(index: EntityIndex, publicIdentifier: string): Partial<Profile> {
  const candidates = select(index, 'identity.profile.Profile', 'fsd_profile');
  if (candidates.length === 0) return {};

  const wanted = publicIdentifier.toLowerCase();
  const exact = candidates.find(
    (entity) => str(entity, 'publicIdentifier')?.toLowerCase() === wanted,
  );
  const entity = exact ?? candidates.slice().sort((a, b) => score(b) - score(a))[0];
  if (!entity) return {};

  const resolved = resolve<RestliEntity>(entity, index);

  const firstName = str(resolved, 'firstName');
  const lastName = str(resolved, 'lastName');
  const locationRaw =
    str(resolved, 'locationName', 'geoLocationName') ??
    asText(pick(resolved, 'geoLocation', 'geo', 'defaultLocalizedName')) ??
    asText(pick(resolved, 'location', 'defaultLocalizedName')) ??
    null;

  const { city, country } = splitLocation(locationRaw);
  const urn = typeof resolved.entityUrn === 'string' ? resolved.entityUrn : null;

  return {
    urn,
    member_id: urnId(urn),
    ...(str(resolved, 'publicIdentifier')
      ? { public_identifier: str(resolved, 'publicIdentifier') as string }
      : {}),
    name: {
      first: firstName,
      last: lastName,
      full: [firstName, lastName].filter(Boolean).join(' ') || null,
      pronouns: str(resolved, 'pronoun', 'standardizedPronoun', 'customPronoun'),
    },
    headline: str(resolved, 'headline', 'occupation'),
    about: str(resolved, 'summary', 'about'),
    location: {
      raw: locationRaw,
      city,
      country,
      country_code:
        (asText(pick(resolved, 'geoLocation', 'geo', 'countryCode')) ??
          str(resolved, 'geoCountryCode')) ||
        null,
    },
    industry:
      asText(pick(resolved, 'industry', 'name')) ??
      str(resolved, 'industryName', 'industryUrn') ??
      null,
    images: {
      avatar: pickImages(resolved, ['profilePicture', 'picture', 'profilePictureOriginalImage']),
      banner: pickImages(resolved, ['backgroundPicture', 'backgroundImage']),
    },
    open_to_work: bool(resolved, 'openToWork'),
    premium: bool(resolved, 'premium', 'showPremiumSubscriberIcon'),
    influencer: bool(resolved, 'influencer', 'showInfluencerBadge'),
    verified: bool(resolved, 'verified', 'isVerified'),
  };
}

function readExperience(index: EntityIndex): Experience[] {
  const rows: Experience[] = [];

  for (const raw of select(index, 'identity.profile.Position', 'fsd_profilePosition')) {
    const entity = resolve<RestliEntity>(raw, index);
    const period = range(entity);
    const company = companyOf(entity, index);

    rows.push({
      title: str(entity, 'title', 'name'),
      company,
      employment_type: str(entity, 'employmentTypeName', 'employmentType', 'employmentTypeUrn'),
      location: str(entity, 'locationName', 'geoLocationName', 'location'),
      description: str(entity, 'description'),
      start: period.start,
      end: period.end,
      // Not present in the dash payload — derived from the range instead.
      duration: str(entity, 'duration', 'durationText') ?? duration(period.start, period.end),
      is_current: period.isCurrent,
      skills: skillNamesOf(entity),
    });
  }

  const cleaned = compact(rows, ['title', 'description', 'start']).filter(
    (row) => row.title || row.company.name,
  );

  return dedupe(cleaned, (row) =>
    [row.title, row.company.name, row.start?.year, row.start?.month].join('|'),
  );
}

function readEducation(index: EntityIndex): Education[] {
  const rows: Education[] = [];

  for (const raw of select(index, 'identity.profile.Education', 'fsd_profileEducation')) {
    const entity = resolve<RestliEntity>(raw, index);
    const period = range(entity);
    const school = isObj(entity['school']) ? entity['school'] : null;

    rows.push({
      school: str(entity, 'schoolName') ?? str(school, 'name'),
      school_urn:
        str(entity, 'schoolUrn') ?? (typeof school?.['entityUrn'] === 'string' ? (school['entityUrn'] as string) : null),
      degree: str(entity, 'degreeName', 'degree'),
      field_of_study: str(entity, 'fieldOfStudy'),
      grade: str(entity, 'grade'),
      description: str(entity, 'description'),
      activities: str(entity, 'activities'),
      start: period.start,
      end: period.end,
      logo: school ? images(school) : images(entity['logo']),
    });
  }

  return dedupe(compact(rows, ['school', 'degree', 'field_of_study']), (row) =>
    [row.school, row.degree, row.start?.year].join('|'),
  );
}

function readSkills(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Skill', 'fsd_profileSkill').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    return {
      name: str(entity, 'name', 'title') ?? '',
      endorsement_count: endorsementsOf(entity),
    };
  });

  return dedupe(
    rows.filter((row) => row.name.length > 0),
    (row) => row.name.toLowerCase(),
  );
}

/**
 * Endorsement counts hide in an insight sub-entity whose text reads
 * "12 endorsements", so we parse the digits out rather than trusting a field
 * that is not always present as a number.
 */
function endorsementsOf(entity: RestliEntity): number | null {
  const direct = num(entity, 'endorsementCount', 'endorsedCount');
  if (direct !== null) return direct;

  const insight = asText(entity['insightsResolutionResults']) ?? asText(entity['insights']);
  if (!insight) return null;

  const match = /(\d[\d,]*)\s+endorsement/i.exec(insight);
  if (!match?.[1]) return null;

  const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCertifications(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Certification', 'fsd_profileCertification').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    const period = range(entity);
    return {
      name: str(entity, 'name', 'title'),
      authority: str(entity, 'authority', 'companyName') ?? str(entity['company'], 'name'),
      license_number: str(entity, 'licenseNumber'),
      url: str(entity, 'url'),
      start: period.start,
      end: period.end,
    };
  });

  return dedupe(compact(rows, ['name']), (row) => [row.name, row.authority].join('|'));
}

function readLanguages(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Language', 'fsd_profileLanguage').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    return {
      name: str(entity, 'name') ?? '',
      proficiency: str(entity, 'proficiency', 'proficiencyName'),
    };
  });

  return dedupe(
    rows.filter((row) => row.name.length > 0),
    (row) => row.name.toLowerCase(),
  );
}

function readProjects(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Project', 'fsd_profileProject').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    const period = range(entity);
    return {
      name: str(entity, 'title', 'name'),
      description: str(entity, 'description'),
      url: str(entity, 'url'),
      start: period.start,
      end: period.end,
    };
  });

  return dedupe(compact(rows, ['name']), (row) => String(row.name));
}

function readHonors(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Honor', 'fsd_profileHonor').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    return {
      title: str(entity, 'title', 'name'),
      issuer: str(entity, 'issuer', 'issuerName'),
      description: str(entity, 'description'),
      date: date(entity['issuedOn'] ?? entity['issueDate'] ?? entity['date']),
    };
  });

  return dedupe(compact(rows, ['title']), (row) => String(row.title));
}

function readVolunteering(index: EntityIndex) {
  const rows = select(
    index,
    'identity.profile.VolunteerExperience',
    'fsd_profileVolunteerExperience',
  ).map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    const period = range(entity);
    return {
      role: str(entity, 'role', 'title'),
      organization: str(entity, 'companyName', 'organizationName') ?? str(entity['company'], 'name'),
      cause: str(entity, 'cause', 'causeName'),
      description: str(entity, 'description'),
      start: period.start,
      end: period.end,
    };
  });

  return dedupe(compact(rows, ['role', 'organization']), (row) =>
    [row.role, row.organization].join('|'),
  );
}

function readPublications(index: EntityIndex) {
  const rows = select(index, 'identity.profile.Publication', 'fsd_profilePublication').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    return {
      name: str(entity, 'name', 'title'),
      publisher: str(entity, 'publisher', 'publisherName'),
      description: str(entity, 'description'),
      url: str(entity, 'url'),
      date: date(entity['publishedOn'] ?? entity['date']),
    };
  });

  return dedupe(compact(rows, ['name']), (row) => String(row.name));
}

/**
 * Connection and follower counts live in their own tiny entities rather than on
 * the profile, and only appear when the corresponding profile card was queried.
 */
function readCounts(index: EntityIndex): Partial<Profile> {
  const out: Partial<Profile> = {};

  for (const entity of index.values()) {
    const connections = num(entity, 'connectionsCount', 'numConnections');
    if (connections !== null && out.connections == null) out.connections = connections;

    const followers = num(entity, 'followerCount', 'followersCount', 'numFollowers');
    if (followers !== null && out.followers == null) out.followers = followers;
  }

  return out;
}

/**
 * Activity: posts, reposts and shares from the member share feed.
 *
 * The engagement counts sit behind two pointer hops —
 * `UpdateV2 → *socialDetail → SocialDetail → *totalSocialActivityCounts →
 * SocialActivityCounts` — which the generic resolver follows on its own, so
 * there is no per-type URN bookkeeping here.
 *
 * Note the counts are only present if the request asked for at least one like
 * and one comment; at `numLikes=0` the server omits the counts entities
 * entirely and every number reads null. That is handled at the fetch site.
 */
function readActivity(index: EntityIndex): Activity[] {
  const rows = select(index, 'feed.render.UpdateV2', 'fsd_update').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);

    const metadata = isObj(entity['updateMetadata']) ? entity['updateMetadata'] : null;
    const urn = str(metadata, 'urn') ?? str(entity, 'entityUrn');
    const header = asText(entity['header']);
    const counts = isObj(entity['socialDetail'])
      ? (entity['socialDetail'] as Obj)['totalSocialActivityCounts']
      : null;

    const reactionsByType: Record<string, number> = {};
    if (isObj(counts) && Array.isArray(counts['reactionTypeCounts'])) {
      for (const item of counts['reactionTypeCounts']) {
        const type = str(item, 'reactionType');
        const count = num(item, 'count');
        if (type && count !== null) reactionsByType[type] = count;
      }
    }

    return {
      urn,
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null,
      author: asText(pick(entity, 'actor', 'name')),
      text: asText(pick(entity, 'commentary', 'text')),
      // The header reads "<name> reposted this"; the actor on a repost is the
      // original author, so the header is the only reliable signal.
      is_repost: Boolean(header && /repost/i.test(header)),
      content_type: contentTypeOf(entity['content']),
      posted_at: postedAtFromUrn(urn),
      reactions: num(counts, 'numLikes'),
      comments: num(counts, 'numComments'),
      shares: num(counts, 'numShares'),
      reactions_by_type: reactionsByType,
    };
  });

  return dedupe(compact(rows, ['urn', 'text']), (row) => String(row.urn));
}

/**
 * Recover a post's timestamp from its URN.
 *
 * `urn:li:activity:7483584731645747200` is a Snowflake-style id whose high 41
 * bits are milliseconds since the epoch. Shifting right by 22 yields the post
 * time — so the date comes free from an id we already have, instead of a
 * separate request or a relative string like "2w" that has to be parsed and is
 * only accurate to the week.
 */
function postedAtFromUrn(urn: string | null): string | null {
  const id = urnId(urn);
  if (!id || !/^\d{15,25}$/.test(id)) return null;

  try {
    const millis = Number(BigInt(id) >> 22n);
    if (!Number.isFinite(millis) || millis < 1_000_000_000_000) return null;
    return new Date(millis).toISOString();
  } catch {
    return null;
  }
}

/** The content union names its variant with its single non-`$` key. */
function contentTypeOf(content: unknown): string | null {
  if (!isObj(content)) return null;
  const key = Object.keys(content).find((name) => !name.startsWith('$'));
  return key ?? null;
}

/**
 * "Featured" items, stored as TreasuryMedia.
 *
 * `data` is a tagged union — a single key naming the variant — and for links
 * the value is a bare string rather than an object:
 *
 *     { "Url": "https://github.com/someone" }
 *
 * So the read is: take the first http-prefixed string anywhere in the union,
 * and fall back to `url`/`navigationUrl` on the object-shaped variants (image,
 * document) when there isn't one.
 */
function readFeatured(index: EntityIndex): Featured[] {
  const rows = select(index, 'treasury.TreasuryMedia', 'fsd_treasuryMedia').map((raw) => {
    const entity = resolve<RestliEntity>(raw, index);
    return {
      title: str(entity, 'title'),
      description: str(entity, 'description'),
      url: treasuryUrl(entity['data']) ?? str(entity, 'url', 'navigationUrl'),
      provider: str(entity, 'providerName', 'provider'),
      preview_images: images(entity['previewImage'] ?? entity['thumbnail']),
    };
  });

  return dedupe(compact(rows, ['title', 'url']), (row) => `${row.url ?? ''}|${row.title ?? ''}`);
}

function treasuryUrl(data: unknown): string | null {
  if (typeof data === 'string') return data.startsWith('http') ? data : null;
  if (!isObj(data)) return null;

  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.startsWith('http')) return value;
    if (isObj(value)) {
      const nested = str(value, 'url', 'navigationUrl');
      if (nested) return nested;
    }
  }

  return null;
}

function readContactInfo(index: EntityIndex): ContactInfo | null {
  for (const raw of index.values()) {
    const hasContactShape =
      'emailAddress' in raw || 'phoneNumbers' in raw || 'websites' in raw || 'twitterHandles' in raw;
    if (!hasContactShape) continue;

    const entity = resolve<RestliEntity>(raw, index);

    const email = asText(entity['emailAddress']) ?? str(entity, 'email');
    const phones = arrayOf(entity['phoneNumbers']).flatMap((item) => {
      const number = asText(isObj(item) ? (item['number'] ?? item) : item);
      if (!number) return [];
      return [{ number, type: str(item, 'type', 'phoneType') }];
    });

    const websites = arrayOf(entity['websites']).flatMap((item) => {
      const url = asText(isObj(item) ? (item['url'] ?? item) : item);
      if (!url) return [];
      return [{ url, label: str(item, 'label') ?? asText(pick(item, 'type', 'category')) ?? null }];
    });

    const twitter = arrayOf(entity['twitterHandles']).flatMap((item) => {
      const handle = asText(isObj(item) ? (item['name'] ?? item) : item);
      return handle ? [handle] : [];
    });

    const ims = arrayOf(entity['ims']).flatMap((item) => {
      const handle = asText(isObj(item) ? (item['id'] ?? item) : item);
      if (!handle) return [];
      return [{ provider: str(item, 'provider'), handle }];
    });

    const birthRaw = entity['birthDateOn'] ?? entity['birthDate'];
    const birthday = isObj(birthRaw)
      ? { month: num(birthRaw, 'month'), day: num(birthRaw, 'day') }
      : null;

    const hasAnything =
      email || phones.length || websites.length || twitter.length || ims.length || birthday;
    if (!hasAnything) continue;

    return {
      email: email ?? null,
      phones,
      websites,
      twitter,
      instant_messengers: ims,
      birthday,
      address: str(entity, 'address'),
      connected_at: date(entity['connectedAt'] ?? entity['connectedAtDate']),
    };
  }

  return null;
}

/** Resolve a position's company, whether inlined or referenced by URN. */
function companyOf(entity: RestliEntity, index: EntityIndex): CompanyRef {
  const inline = isObj(entity['company']) ? entity['company'] : null;
  const urn =
    (typeof entity['companyUrn'] === 'string' ? (entity['companyUrn'] as string) : null) ??
    (typeof inline?.['entityUrn'] === 'string' ? (inline['entityUrn'] as string) : null);

  const fromPool = urn ? index.get(urn) : undefined;
  const company = inline ?? (fromPool ? resolve<RestliEntity>(fromPool, index) : null);

  return {
    name: str(entity, 'companyName') ?? str(company, 'name') ?? null,
    urn,
    public_identifier: str(company, 'universalName', 'publicIdentifier'),
    logo: company ? images(company) : [],
  };
}

function skillNamesOf(entity: RestliEntity): string[] {
  const raw = entity['profileTopSkillsUnion'] ?? entity['skills'] ?? entity['skillNames'];
  const names = arrayOf(raw)
    .map((item) => asText(item))
    .filter((name): name is string => Boolean(name));
  return dedupe(names, (name) => name.toLowerCase());
}

function pickImages(source: RestliEntity, keys: string[]): ProfileImage[] {
  for (const key of keys) {
    const found = images(source[key]);
    if (found.length > 0) return found;
  }
  return [];
}

/** Follow a chain of keys, tolerating anything missing along the way. */
function pick(source: unknown, ...keys: string[]): unknown {
  let cursor: unknown = source;
  for (const key of keys) {
    if (!isObj(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function arrayOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObj(value) && Array.isArray(value['elements'])) return value['elements'];
  return [];
}

/** Rough richness measure, used to break ties between profile entities. */
function score(entity: RestliEntity): number {
  return ['firstName', 'lastName', 'headline', 'summary', 'profilePicture', 'publicIdentifier']
    .reduce<number>((total, key) => total + (entity[key] ? 1 : 0), 0);
}
