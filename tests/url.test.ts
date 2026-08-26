import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { parseProfileUrl } from '../src/linkedin/url.js';

describe('parseProfileUrl', () => {
  it('accepts the canonical form', () => {
    const parsed = parseProfileUrl('https://www.linkedin.com/in/williamhgates/');
    expect(parsed.publicIdentifier).toBe('williamhgates');
    expect(parsed.canonicalUrl).toBe('https://www.linkedin.com/in/williamhgates/');
    expect(parsed.kind).toBe('vanity');
  });

  it.each([
    ['https://linkedin.com/in/williamhgates', 'williamhgates'],
    ['http://www.linkedin.com/in/williamhgates/', 'williamhgates'],
    ['www.linkedin.com/in/williamhgates', 'williamhgates'],
    ['linkedin.com/in/williamhgates?originalSubdomain=uk', 'williamhgates'],
    ['https://uk.linkedin.com/in/williamhgates', 'williamhgates'],
    ['https://www.linkedin.com/in/williamhgates/details/experience/', 'williamhgates'],
    ['https://www.linkedin.com/pub/william-gates/1/2/3', 'william-gates'],
    ['in/williamhgates', 'williamhgates'],
    ['williamhgates', 'williamhgates'],
  ])('normalises %s', (input, expected) => {
    expect(parseProfileUrl(input).publicIdentifier).toBe(expected);
  });

  it('decodes percent-encoded slugs', () => {
    // Non-ASCII vanity names are legal and arrive encoded.
    expect(parseProfileUrl('https://www.linkedin.com/in/%C3%A9lodie-martin').publicIdentifier).toBe(
      'élodie-martin',
    );
  });

  it('recognises opaque member identifiers', () => {
    const parsed = parseProfileUrl('https://www.linkedin.com/in/ACoAAD_GsjoB-vd8Te1yT8jD0kb7');
    expect(parsed.kind).toBe('opaque');
  });

  it.each([
    ['https://www.linkedin.com/company/microsoft/', 'company pages'],
    ['https://www.linkedin.com/school/mit/', 'school pages'],
    ['https://www.linkedin.com/feed/', 'the feed'],
    ['https://example.com/in/williamhgates', 'other hosts'],
    ['', 'empty input'],
  ])('rejects %s', (input) => {
    expect(() => parseProfileUrl(input)).toThrow(ApiError);
  });

  it('reports a typed error code rather than a bare throw', () => {
    try {
      parseProfileUrl('https://www.linkedin.com/company/microsoft/');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('INVALID_URL');
      expect((err as ApiError).status).toBe(400);
    }
  });
});
