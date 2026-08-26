import { SCHEMA_VERSION } from './schema.js';
import { ERROR_CODES } from './errors.js';

/**
 * Hand-written OpenAPI 3.1 document.
 *
 * Written by hand rather than generated from the Zod schemas: the canonical
 * profile schema is large and mostly nullable scalars, and a generated document
 * would faithfully reproduce all of it while explaining none of it. The value
 * of this file is the prose — what each parameter costs, why `include=contact`
 * exists, what each error code actually means operationally.
 */
export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'LinkedIn Profile API',
      version: SCHEMA_VERSION,
      description:
        'Resolves a LinkedIn profile URL into structured JSON by calling LinkedIn\'s ' +
        'internal Voyager endpoints with an authenticated session.\n\n' +
        'Extraction runs as a chain of strategies (dash REST → embedded page JSON → ' +
        'GraphQL). Every response reports which strategy produced which field in ' +
        '`meta.field_provenance`, and whether the result is incomplete in `meta.partial`.',
    },
    servers: [{ url: '/', description: 'This deployment' }],
    paths: {
      '/v1/profile': {
        get: {
          summary: 'Resolve a profile URL',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description:
                'A LinkedIn member profile URL. Accepts full URLs, country subdomains, ' +
                'legacy /pub/ URLs, and bare vanity slugs.',
              example: 'https://www.linkedin.com/in/williamhgates/',
            },
            {
              name: 'deep',
              in: 'query',
              schema: { type: 'boolean', default: false },
              description:
                'Fetch complete section lists instead of the profile page previews. ' +
                'Costs several extra upstream requests, so it is off by default.',
            },
            {
              name: 'include',
              in: 'query',
              schema: { type: 'string' },
              description:
                'Comma-separated opt-ins. `contact` adds the contact-info section, which ' +
                'is personal data and is therefore never returned unless asked for.',
              example: 'contact',
            },
            {
              name: 'refresh',
              in: 'query',
              schema: { type: 'boolean', default: false },
              description: 'Bypass the cache and force a fresh upstream fetch.',
            },
          ],
          responses: {
            '200': { description: 'Profile resolved', content: jsonContent('ProfileResponse') },
            ...errorResponses(),
          },
        },
        post: {
          summary: 'Resolve a profile URL (JSON body)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string' },
                    deep: { type: 'boolean', default: false },
                    include: { type: 'string' },
                    refresh: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Profile resolved', content: jsonContent('ProfileResponse') },
            ...errorResponses(),
          },
        },
      },
      '/v1/health': {
        get: {
          summary: 'Liveness and session state',
          description:
            'Returns 503 when no LinkedIn session is configured, so a monitor can alert ' +
            'on an expired cookie before callers start seeing failures.',
          responses: { '200': { description: 'Healthy' }, '503': { description: 'Degraded' } },
        },
      },
      '/v1/admin/cache/purge': {
        post: {
          summary: 'Drop every cached variant of one profile',
          security: [{ adminToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
              },
            },
          },
          responses: { '200': { description: 'Purged' }, '401': { description: 'Unauthorized' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        adminToken: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        ProfileResponse: {
          type: 'object',
          properties: {
            profile: { $ref: '#/components/schemas/Profile' },
            meta: { $ref: '#/components/schemas/Meta' },
          },
        },
        Profile: {
          type: 'object',
          description:
            'Every scalar is nullable and every collection defaults to an empty array. ' +
            'LinkedIn profiles are sparse and field visibility depends on the viewing ' +
            "session's relationship to the member, so absence is normal.",
          properties: {
            public_identifier: { type: 'string' },
            urn: { type: ['string', 'null'] },
            profile_url: { type: 'string' },
            name: {
              type: 'object',
              properties: {
                first: { type: ['string', 'null'] },
                last: { type: ['string', 'null'] },
                full: { type: ['string', 'null'] },
                pronouns: { type: ['string', 'null'] },
              },
            },
            headline: { type: ['string', 'null'] },
            about: { type: ['string', 'null'] },
            location: { type: 'object' },
            images: { type: 'object' },
            experience: { type: 'array', items: { type: 'object' } },
            education: { type: 'array', items: { type: 'object' } },
            skills: { type: 'array', items: { type: 'object' } },
            certifications: { type: 'array', items: { type: 'object' } },
            languages: { type: 'array', items: { type: 'object' } },
            projects: { type: 'array', items: { type: 'object' } },
            honors: { type: 'array', items: { type: 'object' } },
            volunteering: { type: 'array', items: { type: 'object' } },
            publications: { type: 'array', items: { type: 'object' } },
            featured: { type: 'array', items: { type: 'object' } },
            contact_info: {
              type: ['object', 'null'],
              description: 'Only present when `include=contact` was passed.',
            },
          },
        },
        Meta: {
          type: 'object',
          properties: {
            schema_version: { type: 'string' },
            fetched_at: { type: 'string', format: 'date-time' },
            strategies: {
              type: 'array',
              description: 'Each strategy attempted, in order, with its outcome and duration.',
              items: { type: 'object' },
            },
            field_provenance: {
              type: 'object',
              description: 'Maps each populated field to the strategy that supplied it.',
              additionalProperties: { type: 'string' },
            },
            partial: { type: 'boolean' },
            warnings: { type: 'array', items: { type: 'string' } },
            cache: { type: 'string', enum: ['hit', 'miss', 'bypass'] },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: Object.keys(ERROR_CODES) },
                message: { type: 'string' },
                retryable: { type: 'boolean' },
                details: { type: 'object' },
              },
            },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
  };
}

function jsonContent(schema: string) {
  return { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } };
}

function errorResponses() {
  return {
    '400': { description: 'INVALID_URL', content: jsonContent('Error') },
    '401': { description: 'UNAUTHORIZED', content: jsonContent('Error') },
    '403': { description: 'PROFILE_NOT_VISIBLE — out of network, or private', content: jsonContent('Error') },
    '404': { description: 'PROFILE_NOT_FOUND', content: jsonContent('Error') },
    '429': { description: 'RATE_LIMITED', content: jsonContent('Error') },
    '502': {
      description: 'AUTH_WALL, UPSTREAM_BLOCKED or ALL_STRATEGIES_FAILED',
      content: jsonContent('Error'),
    },
    '503': { description: 'SESSION_EXPIRED or SESSION_MISSING', content: jsonContent('Error') },
    '504': { description: 'UPSTREAM_TIMEOUT', content: jsonContent('Error') },
  };
}
