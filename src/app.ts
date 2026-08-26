import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { cache, profileCacheKey, profileCacheKeyVariants } from './cache.js';
import { config } from './config.js';
import { ApiError, toApiError } from './errors.js';
import { extractProfile } from './linkedin/extract.js';
import { knownQueryIds } from './linkedin/query-ids.js';
import { parseProfileUrl } from './linkedin/url.js';
import { openApiDocument } from './openapi.js';
import { PLAYGROUND_HTML } from './playground.js';
import { checkRateLimit } from './rate-limit.js';
import { SCHEMA_VERSION } from './schema.js';
import type { ProfileResponse } from './schema.js';

/**
 * HTTP surface.
 *
 * One resource, two verbs, and enough operational endpoints to run the thing:
 * a health check that reports whether the LinkedIn session is actually alive,
 * and an admin route to purge a cached profile.
 */

const requestSchema = z.object({
  url: z.string().min(1, 'url is required'),
  /** Fetch complete section lists instead of the profile page's previews. */
  deep: z.coerce.boolean().optional().default(false),
  /** Comma-separated opt-ins. Currently only `contact`. */
  include: z.string().optional().default(''),
  /** Bypass the cache for this request. */
  refresh: z.coerce.boolean().optional().default(false),
});

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));
  app.use(requestId);

  app.get('/', (_req, res) => {
    res.type('html').send(PLAYGROUND_HTML);
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });

  /**
   * Liveness plus session state. Deployment platforms want a 200; an operator
   * wants to know whether the cookies still work — this answers both, and
   * returns 503 when the session is dead so a monitor can alert on it.
   */
  app.get('/v1/health', async (_req, res) => {
    const sessionConfigured = config.isConfigured;
    res.status(sessionConfigured ? 200 : 503).json({
      status: sessionConfigured ? 'ok' : 'degraded',
      schema_version: SCHEMA_VERSION,
      session: {
        configured: sessionConfigured,
        csrf_token_present: Boolean(config.csrfToken),
      },
      cache: cache().name,
      strategies: config.strategyOrder,
      query_ids: knownQueryIds(),
      uptime_seconds: Math.round(process.uptime()),
    });
  });

  app.get('/v1/profile', authenticate, rateLimit, async (req, res) => {
    const parsed = requestSchema.parse(req.query);
    res.json(await handleProfile(parsed));
  });

  app.post('/v1/profile', authenticate, rateLimit, async (req, res) => {
    const parsed = requestSchema.parse(req.body ?? {});
    res.json(await handleProfile(parsed));
  });

  app.post('/v1/admin/cache/purge', requireAdmin, async (req, res) => {
    const { url } = z.object({ url: z.string().min(1) }).parse(req.body ?? {});
    const target = parseProfileUrl(url);

    await Promise.all(
      profileCacheKeyVariants(target.publicIdentifier).map((key) => cache().del(key)),
    );

    res.json({ purged: target.publicIdentifier });
  });

  app.use((_req, res) => {
    res.status(404).json(new ApiError('INVALID_URL', 'No such route.').toJSON());
  });

  app.use(errorHandler);
  return app;
}

async function handleProfile(input: z.infer<typeof requestSchema>): Promise<ProfileResponse> {
  const target = parseProfileUrl(input.url);
  const includes = new Set(
    input.include
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const includeContact = includes.has('contact');
  const includeActivity = includes.has('activity');

  const key = profileCacheKey(target.publicIdentifier, {
    deep: input.deep,
    contact: includeContact,
    activity: includeActivity,
  });

  if (!input.refresh) {
    const hit = await cache().get<ProfileResponse>(key);
    if (hit) {
      return {
        ...hit.value,
        meta: { ...hit.value.meta, cache: 'hit' },
      };
    }
  }

  const result = await extractProfile(target, {
    deep: input.deep,
    includeContact,
    includeActivity,
  });

  const response: ProfileResponse = {
    profile: result.profile,
    meta: {
      schema_version: SCHEMA_VERSION,
      fetched_at: new Date().toISOString(),
      strategies: result.strategies,
      field_provenance: result.provenance,
      partial: result.partial,
      warnings: result.warnings,
      cache: input.refresh ? 'bypass' : 'miss',
    },
  };

  await cache().set(key, response, config.cacheTtlSeconds);
  return response;
}

/**
 * API key check. When `API_KEYS` is unset the service runs open, which is
 * correct for local development and explicitly called out in the README as
 * something to set before deploying.
 */
function authenticate(req: Request, res: Response, next: NextFunction): void {
  const keys = config.apiKeys;
  if (keys.length === 0) return next();

  const presented = req.header('x-api-key') ?? bearer(req);
  if (!presented || !keys.includes(presented)) {
    res.status(401).json(new ApiError('UNAUTHORIZED', 'Missing or invalid API key.').toJSON());
    return;
  }

  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = config.adminToken;
  if (!token || bearer(req) !== token) {
    res.status(401).json(new ApiError('UNAUTHORIZED', 'Admin token required.').toJSON());
    return;
  }
  next();
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const identity = req.header('x-api-key') ?? req.ip ?? 'anonymous';
  const result = checkRateLimit(identity);

  res.setHeader('x-ratelimit-limit', result.limit);
  res.setHeader('x-ratelimit-remaining', result.remaining);
  res.setHeader('x-ratelimit-reset', Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    res
      .status(429)
      .json(
        new ApiError('RATE_LIMITED', `Rate limit of ${result.limit} requests/minute exceeded.`, {
          retry_after_seconds: Math.ceil((result.resetAt - Date.now()) / 1000),
        }).toJSON(),
      );
    return;
  }

  next();
}

function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.header('x-request-id') ?? randomId();
  res.setHeader('x-request-id', id);
  next();
}

function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof z.ZodError) {
    res.status(400).json(
      new ApiError('INVALID_URL', 'Request validation failed.', {
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }).toJSON(),
    );
    return;
  }

  const apiError = toApiError(err);

  // Upstream failures are the interesting ones operationally; log with the
  // request id so a report of "it returned 502" is traceable.
  if (apiError.status >= 500) {
    console.error(
      JSON.stringify({
        level: 'error',
        request_id: res.getHeader('x-request-id'),
        path: req.path,
        code: apiError.code,
        message: apiError.message,
      }),
    );
  }

  res.status(apiError.status).json(apiError.toJSON());
}

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
