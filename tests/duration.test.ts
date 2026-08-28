import { describe, expect, it } from 'vitest';
import { duration } from '../src/linkedin/normalize/helpers.js';

/**
 * LinkedIn renders position spans as "2 yrs 3 mos" but does not send that
 * string in the dash payload, so it is computed. The counting is inclusive —
 * a role held for one calendar month reads "1 mo", not "0 mos".
 */
describe('duration', () => {
  const now = new Date('2026-08-28T00:00:00Z');

  it('renders years and months together', () => {
    expect(duration({ year: 2020, month: 1, day: null }, { year: 2022, month: 3, day: null })).toBe(
      '2 yrs 3 mos',
    );
  });

  it('singularises a single year and a single month', () => {
    expect(duration({ year: 2020, month: 1, day: null }, { year: 2021, month: 1, day: null })).toBe(
      '1 yr 1 mo',
    );
  });

  it('omits the year part under twelve months', () => {
    expect(duration({ year: 2020, month: 1, day: null }, { year: 2020, month: 4, day: null })).toBe(
      '4 mos',
    );
  });

  it('counts inclusively — one calendar month is "1 mo"', () => {
    expect(duration({ year: 2020, month: 6, day: null }, { year: 2020, month: 6, day: null })).toBe(
      '1 mo',
    );
  });

  it('measures an open-ended range to today', () => {
    expect(duration({ year: 2025, month: 1, day: null }, null, now)).toBe('1 yr 8 mos');
  });

  it('returns null without a start month rather than inventing precision', () => {
    // A year alone cannot yield a month count.
    expect(duration({ year: 2020, month: null, day: null }, { year: 2022, month: 3, day: null })).toBeNull();
    expect(duration(null, null)).toBeNull();
  });

  it('returns null for an end that precedes the start', () => {
    expect(duration({ year: 2022, month: 5, day: null }, { year: 2020, month: 1, day: null })).toBeNull();
  });
});
