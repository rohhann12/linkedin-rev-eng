import type { Profile } from '../../schema.js';
import { isObj } from './helpers.js';

/**
 * Merges what each strategy produced into one canonical profile, recording
 * which strategy supplied each field.
 *
 * The rules, and why:
 *
 *  - **Scalars: first writer wins.** Strategies run in trust order, so the
 *    earlier one is the better source. A later strategy can fill a gap but
 *    never overwrite.
 *  - **Collections: the larger set wins.** Section coverage is the thing that
 *    varies most between strategies — a rotated GraphQL query might return two
 *    positions where the embedded payload had nine. Count is a crude proxy for
 *    completeness, but it is the honest one, and provenance records the choice
 *    so nothing is hidden.
 *  - **Nested objects merge per key**, so a name from one strategy and a
 *    pronoun from another combine instead of one shadowing the other.
 */

const COLLECTION_KEYS = [
  'experience',
  'education',
  'skills',
  'certifications',
  'languages',
  'projects',
  'honors',
  'volunteering',
  'publications',
] as const satisfies readonly (keyof Profile)[];

/** Fields the caller never set explicitly and that should not claim provenance. */
const STRUCTURAL_KEYS = new Set(['public_identifier', 'profile_url']);

export type Provenance = Record<string, string>;

export function mergeInto(
  target: Profile,
  patch: Partial<Profile>,
  strategy: string,
  provenance: Provenance,
): void {
  for (const [key, incoming] of Object.entries(patch) as [keyof Profile, unknown][]) {
    if (incoming === null || incoming === undefined) continue;

    const name = String(key);
    const current = target[key] as unknown;

    if (Array.isArray(incoming)) {
      const currentLength = Array.isArray(current) ? current.length : 0;
      if (incoming.length > currentLength) {
        (target as Record<string, unknown>)[name] = incoming;
        provenance[name] = strategy;
      }
      continue;
    }

    if (isObj(incoming)) {
      const merged = mergeObject(
        isObj(current) ? current : {},
        incoming,
        name,
        strategy,
        provenance,
      );
      (target as Record<string, unknown>)[name] = merged;
      continue;
    }

    // Scalar: only fill a hole.
    const isHole = current === null || current === undefined || current === '';
    if (isHole) {
      (target as Record<string, unknown>)[name] = incoming;
      if (!STRUCTURAL_KEYS.has(name)) provenance[name] = strategy;
    }
  }
}

function mergeObject(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  path: string,
  strategy: string,
  provenance: Provenance,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;

    const existing = out[key];

    if (Array.isArray(value)) {
      const existingLength = Array.isArray(existing) ? existing.length : 0;
      if (value.length > existingLength) {
        out[key] = value;
        provenance[`${path}.${key}`] = strategy;
      }
      continue;
    }

    if (isObj(value)) {
      out[key] = mergeObject(
        isObj(existing) ? existing : {},
        value,
        `${path}.${key}`,
        strategy,
        provenance,
      );
      continue;
    }

    if (existing === null || existing === undefined || existing === '') {
      out[key] = value;
      provenance[`${path}.${key}`] = strategy;
    }
  }

  return out;
}

/**
 * Which sections came back empty. Reported as `meta.warnings` so a caller can
 * distinguish "this member has no certifications" from "we failed to read the
 * certifications section" — the API cannot always tell the difference, and
 * saying so is more useful than pretending otherwise.
 */
export function emptySections(profile: Profile): string[] {
  return COLLECTION_KEYS.filter((key) => {
    const value = profile[key];
    return Array.isArray(value) && value.length === 0;
  }).map(String);
}

/** A profile is usable if we at least identified the person. */
export function isUsable(profile: Profile): boolean {
  return Boolean(profile.name.full ?? profile.headline ?? profile.urn);
}
