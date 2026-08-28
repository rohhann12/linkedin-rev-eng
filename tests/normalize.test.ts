import { describe, expect, it } from 'vitest';
import { extractEmbedded } from '../src/linkedin/fetchers/embedded.js';
import { normalizeDom } from '../src/linkedin/fetchers/dom.js';
import { normalizeDash } from '../src/linkedin/normalize/dash.js';
import { profileSchema } from '../src/schema.js';

/**
 * A dash payload in the shape the live `FullProfileWithEntities-101` decoration
 * returns: entities tagged by `$type`, dates as `dateRange`, images as
 * `VectorImage` root + artifacts, companies referenced by URN.
 */
const dashEnvelope = {
  data: { '*elements': ['urn:li:fsd_profile:ACoAAA'] },
  included: [
    {
      entityUrn: 'urn:li:fsd_profile:ACoAAA',
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      firstName: 'Ada',
      lastName: 'Lovelace',
      publicIdentifier: 'adalovelace',
      headline: 'Mathematician',
      summary: 'First computer programmer.',
      locationName: 'London, England, United Kingdom',
      profilePicture: {
        displayImageReference: {
          vectorImage: {
            rootUrl: 'https://media.licdn.com/dms/image/',
            artifacts: [
              { width: 100, height: 100, fileIdentifyingUrlPathSegment: 'small.jpg' },
              { width: 800, height: 800, fileIdentifyingUrlPathSegment: 'large.jpg' },
            ],
          },
        },
      },
    },
    {
      entityUrn: 'urn:li:fsd_profilePosition:1',
      $type: 'com.linkedin.voyager.dash.identity.profile.Position',
      title: 'Analyst',
      companyName: 'Analytical Engines',
      locationName: 'London',
      description: 'Designed algorithms.',
      dateRange: { start: { year: 1842, month: 6 } },
      '*company': 'urn:li:fsd_company:99',
    },
    {
      entityUrn: 'urn:li:fsd_company:99',
      $type: 'com.linkedin.voyager.dash.organization.Company',
      name: 'Analytical Engines',
      universalName: 'analytical-engines',
    },
    {
      entityUrn: 'urn:li:fsd_profileEducation:1',
      $type: 'com.linkedin.voyager.dash.identity.profile.Education',
      schoolName: 'University of London',
      degreeName: 'BSc',
      fieldOfStudy: 'Mathematics',
      dateRange: { start: { year: 1830 }, end: { year: 1835 } },
    },
    {
      entityUrn: 'urn:li:fsd_profileSkill:1',
      $type: 'com.linkedin.voyager.dash.identity.profile.Skill',
      name: 'Algorithms',
    },
    {
      entityUrn: 'urn:li:fsd_treasuryMedia:1',
      $type: 'com.linkedin.voyager.dash.identity.profile.treasury.TreasuryMedia',
      title: 'Note G',
      data: { Url: 'https://example.com/note-g' },
    },
  ],
};

describe('normalizeDash', () => {
  const patch = normalizeDash(dashEnvelope, 'adalovelace');

  it('reads identity fields', () => {
    expect(patch.name?.full).toBe('Ada Lovelace');
    expect(patch.headline).toBe('Mathematician');
    expect(patch.about).toBe('First computer programmer.');
  });

  it('splits the location display string without losing the original', () => {
    expect(patch.location?.raw).toBe('London, England, United Kingdom');
    expect(patch.location?.city).toBe('London');
    expect(patch.location?.country).toBe('United Kingdom');
  });

  it('rebuilds image URLs from the vector root and sorts largest first', () => {
    expect(patch.images?.avatar[0]).toEqual({
      url: 'https://media.licdn.com/dms/image/large.jpg',
      width: 800,
      height: 800,
    });
  });

  it('resolves a position through its company URN', () => {
    const [position] = patch.experience ?? [];
    expect(position?.title).toBe('Analyst');
    expect(position?.company.name).toBe('Analytical Engines');
    expect(position?.company.public_identifier).toBe('analytical-engines');
  });

  it('derives a duration string, since the dash payload does not carry one', () => {
    // Open-ended range measured to today, the way LinkedIn's own UI renders it.
    expect(patch.experience?.[0]?.duration).toMatch(/^\d+ (yr|mo)/);
  });

  it('treats a missing end date as the current role', () => {
    expect(patch.experience?.[0]?.start).toEqual({ year: 1842, month: 6, day: null });
    expect(patch.experience?.[0]?.is_current).toBe(true);
  });

  it('reads education and skills', () => {
    expect(patch.education?.[0]?.school).toBe('University of London');
    expect(patch.education?.[0]?.field_of_study).toBe('Mathematics');
    expect(patch.skills?.[0]?.name).toBe('Algorithms');
  });

  it('unwraps the TreasuryMedia tagged union to a plain URL', () => {
    expect(patch.featured?.[0]).toMatchObject({
      title: 'Note G',
      url: 'https://example.com/note-g',
    });
  });

  it('produces output that satisfies the published schema', () => {
    const merged = { ...patch, public_identifier: 'adalovelace', profile_url: 'https://x/' };
    expect(() => profileSchema.parse(merged)).not.toThrow();
  });

  it('returns an empty patch rather than throwing on an unknown payload', () => {
    expect(normalizeDash({ included: [] }, 'nobody')).toEqual({});
  });
});

describe('normalizeDash — activity', () => {
  const activityEnvelope = {
    included: [
      {
        entityUrn: 'urn:li:fsd_update:1',
        $type: 'com.linkedin.voyager.feed.render.UpdateV2',
        updateMetadata: { urn: 'urn:li:activity:7483584731645747200' },
        actor: { name: { text: 'Grace Hopper' } },
        header: { text: { text: 'Ada Lovelace reposted this' } },
        commentary: { text: { text: 'Worth reading.' } },
        content: { $type: 'x', articleComponent: {} },
        '*socialDetail': 'urn:li:fsd_socialDetail:1',
      },
      {
        entityUrn: 'urn:li:fsd_socialDetail:1',
        $type: 'com.linkedin.voyager.feed.SocialDetail',
        '*totalSocialActivityCounts': 'urn:li:fsd_counts:1',
      },
      {
        entityUrn: 'urn:li:fsd_counts:1',
        $type: 'com.linkedin.voyager.shared.SocialActivityCounts',
        numLikes: 20254,
        numComments: 317,
        numShares: 852,
        reactionTypeCounts: [{ reactionType: 'LIKE', count: 18061 }],
      },
    ],
  };

  const [post] = normalizeDash(activityEnvelope, 'adalovelace').activity ?? [];

  it('follows the two-hop pointer chain to the engagement counts', () => {
    // UpdateV2 -> *socialDetail -> SocialDetail -> *totalSocialActivityCounts.
    expect(post?.reactions).toBe(20254);
    expect(post?.comments).toBe(317);
    expect(post?.shares).toBe(852);
    expect(post?.reactions_by_type).toEqual({ LIKE: 18061 });
  });

  it('detects a repost from the header, not the actor', () => {
    // The actor on a repost is the original author, so actor-vs-owner is the
    // wrong test and gets the answer backwards.
    expect(post?.is_repost).toBe(true);
    expect(post?.author).toBe('Grace Hopper');
  });

  it('recovers the post timestamp from the activity URN', () => {
    // Activity ids are Snowflake-style: the high 41 bits are epoch millis.
    expect(post?.posted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const year = new Date(post!.posted_at!).getUTCFullYear();
    expect(year).toBeGreaterThan(2015);
    expect(year).toBeLessThan(2035);
  });

  it('names the content variant', () => {
    expect(post?.content_type).toBe('articleComponent');
  });
});

describe('extractEmbedded', () => {
  it('pairs request descriptors with their payload blocks', () => {
    const html = `
      <html><body>
      <code id="bpr-guid-1">{"request":"/voyager/api/identity/dash/profiles","status":200,"body":"bpr-guid-2"}</code>
      <code id="bpr-guid-2">{"data":{},"included":[{"entityUrn":"urn:li:fsd_profile:X","$type":"com.linkedin.voyager.dash.identity.profile.Profile","firstName":"Ada"}]}</code>
      </body></html>`;

    const result = extractEmbedded(html);
    expect(result.requests).toContain('/voyager/api/identity/dash/profiles');
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]?.included?.[0]?.firstName).toBe('Ada');
  });

  it('decodes HTML-escaped JSON', () => {
    const html = `<code id="bpr-guid-3">{&quot;included&quot;:[{&quot;name&quot;:&quot;A &amp; B&quot;}]}</code>`;
    const result = extractEmbedded(html);
    expect(result.envelopes[0]?.included?.[0]?.name).toBe('A & B');
  });

  it('harvests GraphQL query hashes for the tier below it', () => {
    const html = `<script>x="voyagerIdentityDashProfileCards.0123456789abcdef0123456789abcdef"</script>`;
    expect(extractEmbedded(html).queryIds).toEqual([
      'voyagerIdentityDashProfileCards.0123456789abcdef0123456789abcdef',
    ]);
  });

  it('ignores blocks that are not JSON', () => {
    expect(extractEmbedded('<code id="bpr-guid-9">not json</code>').envelopes).toHaveLength(0);
  });
});

describe('normalizeDom', () => {
  /**
   * The regression that matters: LinkedIn renders every visible string twice,
   * once for sighted users and once for screen readers. Reading all text nodes
   * yields each value doubled and shifts every positional field read by one.
   */
  it('does not double-count the screen-reader twin of each string', () => {
    const html = `
      <html><body><main>
        <h1>Ada Lovelace</h1>
        <div class="text-body-medium break-words">Mathematician</div>
        <div id="experience"></div>
        <section>
          <div id="experience"></div>
          <ul>
            <li class="artdeco-list__item">
              <span aria-hidden="true">Analyst</span><span class="visually-hidden">Analyst</span>
              <span aria-hidden="true">Analytical Engines</span><span class="visually-hidden">Analytical Engines</span>
              <span aria-hidden="true">1842 - 1843</span><span class="visually-hidden">1842 - 1843</span>
            </li>
          </ul>
        </section>
      </main></body></html>`;

    const patch = normalizeDom(html, 'adalovelace');
    expect(patch.name?.full).toBe('Ada Lovelace');

    const [position] = patch.experience ?? [];
    expect(position?.title).toBe('Analyst');
    expect(position?.company.name).toBe('Analytical Engines');
  });

  it('classifies the date line instead of trusting its position', () => {
    const html = `
      <html><body><main>
        <section>
          <div id="experience"></div>
          <ul><li class="artdeco-list__item">
            <span aria-hidden="true">Engineer</span>
            <span aria-hidden="true">Acme</span>
            <span aria-hidden="true">Jan 2020 - Present</span>
          </li></ul>
        </section>
      </main></body></html>`;

    expect(normalizeDom(html, 'x').experience?.[0]?.is_current).toBe(true);
  });
});
