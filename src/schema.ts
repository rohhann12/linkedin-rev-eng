import { z } from 'zod';

/**
 * The canonical response shape. Design rules, applied consistently:
 *
 *  - Every scalar is nullable. LinkedIn profiles are sparse by nature and the
 *    visibility of any given field depends on the viewer's relationship to the
 *    member, so "absent" is a normal outcome, not an error.
 *  - Every collection defaults to `[]`, never null, so callers can iterate
 *    without guarding.
 *  - Dates are structured `{year, month}` rather than ISO strings, because
 *    LinkedIn genuinely does not store a day and inventing one would be a lie.
 *  - `meta` carries provenance. A consumer can tell which strategy produced the
 *    payload and which fields are missing versus merely unavailable.
 */

export const SCHEMA_VERSION = '1.0';

const dateSchema = z
  .object({
    year: z.number().int().nullable().default(null),
    month: z.number().int().min(1).max(12).nullable().default(null),
    day: z.number().int().min(1).max(31).nullable().default(null),
  })
  .nullable();

const imageSchema = z.object({
  url: z.string(),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
});

const companyRefSchema = z.object({
  name: z.string().nullable().default(null),
  urn: z.string().nullable().default(null),
  /** LinkedIn company page slug, when the company is a claimed page. */
  public_identifier: z.string().nullable().default(null),
  logo: z.array(imageSchema).default([]),
});

export const experienceSchema = z.object({
  title: z.string().nullable().default(null),
  company: companyRefSchema,
  employment_type: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  start: dateSchema.default(null),
  end: dateSchema.default(null),
  /** LinkedIn's own rendering, e.g. "2 yrs 3 mos". Kept verbatim. */
  duration: z.string().nullable().default(null),
  is_current: z.boolean().default(false),
  skills: z.array(z.string()).default([]),
});

export const educationSchema = z.object({
  school: z.string().nullable().default(null),
  school_urn: z.string().nullable().default(null),
  degree: z.string().nullable().default(null),
  field_of_study: z.string().nullable().default(null),
  grade: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  activities: z.string().nullable().default(null),
  start: dateSchema.default(null),
  end: dateSchema.default(null),
  logo: z.array(imageSchema).default([]),
});

export const skillSchema = z.object({
  name: z.string(),
  endorsement_count: z.number().int().nullable().default(null),
});

export const certificationSchema = z.object({
  name: z.string().nullable().default(null),
  authority: z.string().nullable().default(null),
  license_number: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  start: dateSchema.default(null),
  end: dateSchema.default(null),
});

export const languageSchema = z.object({
  name: z.string(),
  proficiency: z.string().nullable().default(null),
});

export const projectSchema = z.object({
  name: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  start: dateSchema.default(null),
  end: dateSchema.default(null),
});

export const honorSchema = z.object({
  title: z.string().nullable().default(null),
  issuer: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  date: dateSchema.default(null),
});

export const volunteerSchema = z.object({
  role: z.string().nullable().default(null),
  organization: z.string().nullable().default(null),
  cause: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  start: dateSchema.default(null),
  end: dateSchema.default(null),
});

export const publicationSchema = z.object({
  name: z.string().nullable().default(null),
  publisher: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  date: dateSchema.default(null),
});

/**
 * Contact details as surfaced by LinkedIn's own "Contact info" overlay.
 *
 * Two things to understand about this section:
 *
 *  - It is *viewer-scoped*. What comes back depends on the authenticated
 *    session's relationship to the member and on that member's privacy
 *    settings. `email` is typically only present for 1st-degree connections who
 *    chose to share it. An empty section is the common case, not a bug.
 *  - It is personal data. The API never returns it unless the caller opts in
 *    with `include=contact`, and it is excluded from the default cache entry.
 */
export const contactInfoSchema = z.object({
  email: z.string().nullable().default(null),
  phones: z
    .array(
      z.object({
        number: z.string(),
        type: z.string().nullable().default(null),
      }),
    )
    .default([]),
  websites: z
    .array(
      z.object({
        url: z.string(),
        label: z.string().nullable().default(null),
      }),
    )
    .default([]),
  twitter: z.array(z.string()).default([]),
  instant_messengers: z
    .array(
      z.object({
        provider: z.string().nullable().default(null),
        handle: z.string(),
      }),
    )
    .default([]),
  /** LinkedIn stores no year for birthdays. */
  birthday: z
    .object({
      month: z.number().int().min(1).max(12).nullable().default(null),
      day: z.number().int().min(1).max(31).nullable().default(null),
    })
    .nullable()
    .default(null),
  address: z.string().nullable().default(null),
  /** When the session's member connected with this profile, if at all. */
  connected_at: z
    .object({
      year: z.number().int().nullable().default(null),
      month: z.number().int().nullable().default(null),
      day: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
});

/**
 * The profile's "Featured" section. LinkedIn models these as `TreasuryMedia`
 * entities, and they arrive inside the main profile response rather than from
 * an endpoint of their own — `profileTreasuryMedia?q=viewee` returns 400.
 */
export const featuredSchema = z.object({
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
  preview_images: z.array(imageSchema).default([]),
});

/**
 * A post, repost or share from the member's activity feed.
 *
 * `is_repost` is derived from the update header ("<name> reposted this"), not
 * from the author: on a repost `actor.name` is the *original* poster, so
 * comparing it against the profile owner gets the answer backwards.
 */
export const activitySchema = z.object({
  urn: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  is_repost: z.boolean().default(false),
  content_type: z.string().nullable().default(null),
  /** Recovered from the activity URN's embedded timestamp. */
  posted_at: z.string().nullable().default(null),
  reactions: z.number().int().nullable().default(null),
  comments: z.number().int().nullable().default(null),
  shares: z.number().int().nullable().default(null),
  reactions_by_type: z.record(z.number().int()).default({}),
});

export const profileSchema = z.object({
  public_identifier: z.string(),
  urn: z.string().nullable().default(null),
  member_id: z.string().nullable().default(null),
  profile_url: z.string(),

  name: z.object({
    first: z.string().nullable().default(null),
    last: z.string().nullable().default(null),
    full: z.string().nullable().default(null),
    /** Pronunciation hint and maiden name, when the member has set them. */
    pronouns: z.string().nullable().default(null),
  }),

  headline: z.string().nullable().default(null),
  about: z.string().nullable().default(null),

  location: z.object({
    raw: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    country: z.string().nullable().default(null),
    country_code: z.string().nullable().default(null),
  }),

  industry: z.string().nullable().default(null),
  current_company: companyRefSchema.nullable().default(null),

  images: z.object({
    avatar: z.array(imageSchema).default([]),
    banner: z.array(imageSchema).default([]),
  }),

  open_to_work: z.boolean().nullable().default(null),
  hiring: z.boolean().nullable().default(null),
  premium: z.boolean().nullable().default(null),
  influencer: z.boolean().nullable().default(null),
  verified: z.boolean().nullable().default(null),

  connections: z.number().int().nullable().default(null),
  followers: z.number().int().nullable().default(null),

  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  skills: z.array(skillSchema).default([]),
  certifications: z.array(certificationSchema).default([]),
  languages: z.array(languageSchema).default([]),
  projects: z.array(projectSchema).default([]),
  honors: z.array(honorSchema).default([]),
  volunteering: z.array(volunteerSchema).default([]),
  publications: z.array(publicationSchema).default([]),
  featured: z.array(featuredSchema).default([]),

  /** Populated only when the caller passes `include=activity`. */
  activity: z.array(activitySchema).default([]),

  /** Populated only when the caller passes `include=contact`. */
  contact_info: contactInfoSchema.nullable().default(null),
});

export const metaSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  fetched_at: z.string(),
  /** Strategies that were attempted, in order, with their outcome. */
  strategies: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'empty', 'error', 'skipped']),
      duration_ms: z.number().int(),
      error: z.string().nullable().default(null),
    }),
  ),
  /** Which strategy supplied each populated top-level field. */
  field_provenance: z.record(z.string()),
  /** True when at least one section is known to be incomplete. */
  partial: z.boolean(),
  warnings: z.array(z.string()).default([]),
  cache: z.enum(['hit', 'miss', 'bypass']),
});

export const profileResponseSchema = z.object({
  profile: profileSchema,
  meta: metaSchema,
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Language = z.infer<typeof languageSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Honor = z.infer<typeof honorSchema>;
export type Volunteer = z.infer<typeof volunteerSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type ContactInfo = z.infer<typeof contactInfoSchema>;
export type Featured = z.infer<typeof featuredSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type ProfileImage = z.infer<typeof imageSchema>;
export type CompanyRef = z.infer<typeof companyRefSchema>;
export type ProfileDate = z.infer<typeof dateSchema>;

/** An empty canonical profile, used as the merge target across strategies. */
export function emptyProfile(publicIdentifier: string): Profile {
  return profileSchema.parse({
    public_identifier: publicIdentifier,
    profile_url: `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}/`,
    name: {},
    location: {},
    images: {},
  });
}
