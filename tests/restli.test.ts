import { describe, expect, it } from 'vitest';
import { buildIndex, entitiesOfType, resolve, urnId, urnType } from '../src/linkedin/restli.js';

/**
 * The resolver is the load-bearing piece: every strategy funnels through it, so
 * a bug here empties every section at once. These cases mirror the exact shapes
 * observed in a live `FullProfileWithEntities` response.
 */

const envelope = {
  data: {
    '*elements': ['urn:li:fsd_profile:ACoAAA'],
  },
  included: [
    {
      entityUrn: 'urn:li:fsd_profile:ACoAAA',
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      firstName: 'Ada',
      lastName: 'Lovelace',
      '*profilePositions': ['urn:li:fsd_profilePosition:1', 'urn:li:fsd_profilePosition:2'],
    },
    {
      entityUrn: 'urn:li:fsd_profilePosition:1',
      $type: 'com.linkedin.voyager.dash.identity.profile.Position',
      title: 'Analyst',
      '*company': 'urn:li:fsd_company:99',
    },
    {
      entityUrn: 'urn:li:fsd_profilePosition:2',
      $type: 'com.linkedin.voyager.dash.identity.profile.Position',
      title: 'Engineer',
      '*company': 'urn:li:fsd_company:missing',
    },
    {
      entityUrn: 'urn:li:fsd_company:99',
      $type: 'com.linkedin.voyager.dash.organization.Company',
      name: 'Analytical Engines',
    },
  ],
};

describe('buildIndex', () => {
  it('indexes every entity by URN', () => {
    const index = buildIndex(envelope);
    expect(index.size).toBe(4);
    expect(index.get('urn:li:fsd_company:99')?.name).toBe('Analytical Engines');
  });

  it('merges pools from several envelopes', () => {
    const index = buildIndex([envelope, { included: [{ entityUrn: 'urn:li:fsd_company:100' }] }]);
    expect(index.size).toBe(5);
  });
});

describe('resolve', () => {
  it('replaces pointer fields with the entities they name', () => {
    const index = buildIndex(envelope);
    const profile = resolve<Record<string, any>>(index.get('urn:li:fsd_profile:ACoAAA'), index);

    expect(profile.firstName).toBe('Ada');
    // The `*` prefix is stripped and the URNs are inlined.
    expect(profile['*profilePositions']).toBeUndefined();
    expect(profile.profilePositions).toHaveLength(2);
    expect(profile.profilePositions[0].title).toBe('Analyst');
    expect(profile.profilePositions[0].company.name).toBe('Analytical Engines');
  });

  it('surfaces unresolvable pointers instead of dropping them', () => {
    // A silently-null field is indistinguishable from "member has none"; an
    // explicit marker makes a missing entity visible in the output.
    const index = buildIndex(envelope);
    const profile = resolve<Record<string, any>>(index.get('urn:li:fsd_profile:ACoAAA'), index);
    expect(profile.profilePositions[1].company).toEqual({
      __unresolved: 'urn:li:fsd_company:missing',
    });
  });

  it('terminates on cyclic references', () => {
    const cyclic = {
      included: [
        { entityUrn: 'urn:li:a:1', $type: 'A', '*peer': 'urn:li:b:1' },
        { entityUrn: 'urn:li:b:1', $type: 'B', '*peer': 'urn:li:a:1' },
      ],
    };
    const index = buildIndex(cyclic);
    expect(() => resolve(index.get('urn:li:a:1'), index)).not.toThrow();
  });
});

describe('entitiesOfType', () => {
  it('selects by $type suffix, which is what the dash REST payload tags', () => {
    const index = buildIndex(envelope);
    expect(entitiesOfType(index, 'identity.profile.Position')).toHaveLength(2);
    expect(entitiesOfType(index, 'identity.profile.Profile')).toHaveLength(1);
  });

  it('does not confuse Position with PositionGroup', () => {
    const index = buildIndex({
      included: [
        {
          entityUrn: 'urn:li:x:1',
          $type: 'com.linkedin.voyager.dash.identity.profile.PositionGroup',
        },
      ],
    });
    expect(entitiesOfType(index, 'identity.profile.Position')).toHaveLength(0);
  });
});

describe('urn helpers', () => {
  it('splits URNs', () => {
    expect(urnId('urn:li:fsd_profile:ACoAAA')).toBe('ACoAAA');
    expect(urnType('urn:li:fsd_profile:ACoAAA')).toBe('fsd_profile');
    expect(urnId(null)).toBeNull();
  });
});
