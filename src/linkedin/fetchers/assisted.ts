import { profileSchema } from '../../schema.js';
import type { Profile } from '../../schema.js';

/**
 * Optional strategy: model-assisted rescue when the deterministic normalisers
 * come up empty.
 *
 * Everything else in this pipeline is hand-written mapping code: fast, free,
 * and exactly as correct as our understanding of LinkedIn's payloads. The
 * failure mode is schema drift — LinkedIn reshapes an entity, a section starts
 * returning empty, and it stays empty until someone notices and patches the
 * mapper.
 *
 * This tier covers that gap. It takes the raw envelope we could not read and
 * asks a model with enforced JSON-schema output to fill in the canonical shape.
 * Deliberately constrained:
 *
 *  - **Off unless `INTERFAZE_API_KEY` is set.** No key, no tier, no cost.
 *  - **Last, and only on failure.** It never pre-empts a deterministic mapper;
 *    if the normalisers worked, this never runs.
 *  - **Output is validated** against the same Zod schema as every other tier,
 *    so a hallucinated field is dropped rather than served.
 *  - **Provenance marks it.** Anything it produced is attributed to
 *    `assisted` in `meta.field_provenance`, so a consumer can tell
 *    parsed-from-source data from inferred data.
 *
 * Using a model as the *primary* extractor would be the wrong trade — slower,
 * costlier, and non-deterministic for a task where the payload is already
 * structured JSON. As a self-healing backstop it is worth its keep.
 */

const ENDPOINT = 'https://api.interfaze.ai/v1/chat/completions';
const MODEL = 'interfaze-beta';

export function isAssistedAvailable(): boolean {
  return Boolean(process.env.INTERFAZE_API_KEY?.trim());
}

export async function fetchAssisted(
  rawPayload: unknown,
  publicIdentifier: string,
): Promise<Partial<Profile> | null> {
  const apiKey = process.env.INTERFAZE_API_KEY?.trim();
  if (!apiKey) return null;

  // Keep the prompt small: a full profile page's envelope set can run to
  // megabytes, and only the entity pool carries anything useful.
  const payload = JSON.stringify(rawPayload).slice(0, 400_000);

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You convert LinkedIn Voyager API payloads into a fixed JSON shape. ' +
            'Extract only what is present in the payload. Never infer, guess or ' +
            'invent a value; omit anything absent. Respond with JSON only.',
        },
        {
          role: 'user',
          content:
            `Extract the profile for public identifier "${publicIdentifier}" into this shape:\n` +
            `${SHAPE_HINT}\n\nPayload:\n${payload}`,
        },
      ],
    }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  // Validate against the canonical schema; anything that does not fit is
  // discarded rather than trusted.
  const result = profileSchema.partial().safeParse(parsed);
  return result.success ? (result.data as Partial<Profile>) : null;
}

const SHAPE_HINT = `{
  "name": { "first": string|null, "last": string|null, "full": string|null },
  "headline": string|null,
  "about": string|null,
  "location": { "raw": string|null, "city": string|null, "country": string|null },
  "experience": [{ "title": string|null, "company": { "name": string|null },
                   "location": string|null, "description": string|null,
                   "start": { "year": number|null, "month": number|null }|null,
                   "end": { "year": number|null, "month": number|null }|null,
                   "is_current": boolean }],
  "education": [{ "school": string|null, "degree": string|null,
                  "field_of_study": string|null,
                  "start": { "year": number|null }|null,
                  "end": { "year": number|null }|null }],
  "skills": [{ "name": string }],
  "certifications": [{ "name": string|null, "authority": string|null }],
  "languages": [{ "name": string, "proficiency": string|null }]
}`;
