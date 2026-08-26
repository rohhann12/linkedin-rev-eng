/**
 * LinkedIn's internal endpoints answer in Rest.li's normalised JSON envelope:
 *
 *   {
 *     "data":     { "*elements": ["urn:li:fsd_profile:ABC", ...] },
 *     "included": [ { "entityUrn": "urn:li:fsd_profile:ABC", "$type": "...", ... } ]
 *   }
 *
 * `included` is a flat, de-duplicated entity pool; `data` is a skeleton whose
 * `*`-prefixed keys are pointers into that pool. Nothing is nested — a
 * position's company, its logo, and the logo's image artifacts are four
 * separate entries linked by URN.
 *
 * This module is the graph resolver that turns the pool back into a tree. Every
 * strategy (embedded HTML, GraphQL, REST) produces this same envelope, which is
 * why the normaliser downstream only has to be written once.
 */

export interface RestliEnvelope {
  data?: unknown;
  included?: RestliEntity[];
  meta?: unknown;
}

export interface RestliEntity {
  entityUrn?: string;
  $type?: string;
  [key: string]: unknown;
}

export type EntityIndex = Map<string, RestliEntity>;

const MAX_DEPTH = 12;

/** Index every entity in the pool by its URN. Later entries win on collision. */
export function buildIndex(envelope: RestliEnvelope | RestliEnvelope[]): EntityIndex {
  const index: EntityIndex = new Map();
  const envelopes = Array.isArray(envelope) ? envelope : [envelope];

  for (const env of envelopes) {
    for (const entity of collectEntities(env)) {
      const urn = entity.entityUrn ?? (entity['*entityUrn'] as string | undefined);
      if (typeof urn === 'string' && urn.length > 0) index.set(urn, entity);
    }
  }

  return index;
}

/**
 * `included` normally sits at the envelope root, but the embedded-HTML payloads
 * sometimes carry a second pool nested one level down under `data`.
 */
function collectEntities(envelope: RestliEnvelope): RestliEntity[] {
  const pools: RestliEntity[] = [];
  if (Array.isArray(envelope.included)) pools.push(...envelope.included);

  const data = envelope.data as RestliEnvelope | undefined;
  if (data && Array.isArray(data.included)) pools.push(...data.included);

  return pools;
}

/**
 * Recursively replace URN pointers with the entities they name.
 *
 * `*company: "urn:li:fsd_company:1441"` becomes `company: { … }`, and
 * `*elements: [urn, urn]` becomes `elements: [ {…}, {…} ]`. Pointers that
 * cannot be resolved are preserved as `{ __unresolved: urn }` rather than
 * dropped, so a missing entity is visible in the output instead of silently
 * becoming null.
 */
export function resolve<T = unknown>(node: unknown, index: EntityIndex, depth = 0): T {
  if (depth > MAX_DEPTH) return node as T;

  if (Array.isArray(node)) {
    return node.map((item) => resolve(item, index, depth + 1)) as T;
  }

  if (node === null || typeof node !== 'object') {
    return node as T;
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith('*')) {
      const plainKey = key.slice(1);
      out[plainKey] = resolvePointer(value, index, depth);
      continue;
    }
    out[key] = resolve(value, index, depth + 1);
  }

  return out as T;
}

function resolvePointer(value: unknown, index: EntityIndex, depth: number): unknown {
  if (typeof value === 'string') {
    const entity = index.get(value);
    return entity ? resolve(entity, index, depth + 1) : { __unresolved: value };
  }

  if (Array.isArray(value)) {
    return value.map((urn) => resolvePointer(urn, index, depth + 1));
  }

  return resolve(value, index, depth + 1);
}

/**
 * Find pool entities by `$type` suffix, e.g. `entitiesOfType(index, 'Profile')`.
 * Used when a payload's `data` skeleton is unhelpful — common with the
 * embedded-HTML strategy, where we have the pool but not always the query that
 * produced it — and we would rather go straight to the entities we want.
 */
export function entitiesOfType(index: EntityIndex, typeSuffix: string): RestliEntity[] {
  const wanted = typeSuffix.toLowerCase();
  const out: RestliEntity[] = [];

  for (const entity of index.values()) {
    const type = entity.$type;
    if (typeof type === 'string' && type.toLowerCase().endsWith(wanted)) out.push(entity);
  }

  return out;
}

/** Entities whose URN names the given URN type, e.g. `fsd_profilePosition`. */
export function entitiesOfUrnType(index: EntityIndex, urnType: string): RestliEntity[] {
  const prefix = `urn:li:${urnType}:`;
  const out: RestliEntity[] = [];

  for (const [urn, entity] of index.entries()) {
    if (urn.startsWith(prefix)) out.push(entity);
  }

  return out;
}

/** `urn:li:fsd_profile:ACoAAA…` → `ACoAAA…` */
export function urnId(urn: string | undefined | null): string | null {
  if (typeof urn !== 'string') return null;
  const parts = urn.split(':');
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
}

/** `urn:li:fsd_profile:ACoAAA…` → `fsd_profile` */
export function urnType(urn: string | undefined | null): string | null {
  if (typeof urn !== 'string') return null;
  const parts = urn.split(':');
  return parts.length >= 3 ? (parts[2] ?? null) : null;
}

/**
 * Walk an arbitrary structure and hand every object to a visitor. Used by the
 * normalisers to sweep a resolved tree for a shape (a position, a school entry)
 * without depending on the exact path LinkedIn nested it at — those paths churn
 * between releases, the entity shapes are far more stable.
 */
export function walk(node: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1);
    return;
  }

  visit(node as Record<string, unknown>);
  for (const value of Object.values(node as Record<string, unknown>)) {
    walk(value, visit, depth + 1);
  }
}
