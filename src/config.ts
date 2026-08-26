/**
 * Runtime configuration. Everything sensitive arrives through the environment;
 * nothing here has a usable default that would let the service run with
 * committed credentials.
 */

export type StrategyName = 'embedded' | 'graphql' | 'rest';

/**
 * Trust order, verified live 2026-08-26. The dash REST collection answers with
 * clean JSON in one call; the page's embedded JSON is a fallback because the
 * flagship web app has moved to RSC/SDUI and no longer pre-fetches it reliably;
 * GraphQL is last because it needs a per-deploy query hash to work at all.
 */
const ALL_STRATEGIES: StrategyName[] = ['rest', 'embedded', 'graphql'];

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function strategyOrder(): StrategyName[] {
  const requested = list('STRATEGY_ORDER').filter((s): s is StrategyName =>
    (ALL_STRATEGIES as string[]).includes(s),
  );
  return requested.length > 0 ? requested : ALL_STRATEGIES;
}

export const config = {
  /** Full cookie header, assembled from parts when not supplied wholesale. */
  get linkedInCookie(): string {
    const explicit = process.env.LINKEDIN_COOKIE?.trim();
    if (explicit) return explicit;

    const liAt = process.env.LINKEDIN_LI_AT?.trim();
    const jsession = process.env.LINKEDIN_JSESSIONID?.trim();
    if (!liAt) return '';

    const parts = [`li_at=${liAt}`];
    if (jsession) parts.push(`JSESSIONID=${quoteJsession(jsession)}`);
    parts.push('lang=v=2&lang=en-us', 'liap=true');
    return parts.join('; ');
  },

  /**
   * LinkedIn requires the CSRF token to equal the JSESSIONID value with the
   * surrounding quotes stripped. We accept either form in the environment.
   */
  get csrfToken(): string {
    const explicit = process.env.LINKEDIN_JSESSIONID?.trim();
    if (explicit) return unquote(explicit);

    const cookie = process.env.LINKEDIN_COOKIE ?? '';
    const match = /JSESSIONID=("?)(ajax:[0-9-]+)\1/.exec(cookie);
    return match?.[2] ?? '';
  },

  get apiKeys(): string[] {
    return list('API_KEYS');
  },

  get adminToken(): string {
    return process.env.ADMIN_TOKEN?.trim() ?? '';
  },

  get cacheTtlSeconds(): number {
    return int('CACHE_TTL_SECONDS', 86_400);
  },

  get rateLimitPerMinute(): number {
    return int('RATE_LIMIT_PER_MINUTE', 20);
  },

  /** Politeness floor between two consecutive upstream requests. */
  get upstreamMinIntervalMs(): number {
    return int('UPSTREAM_MIN_INTERVAL_MS', 1_500);
  },

  get fetchTimeoutMs(): number {
    return int('FETCH_TIMEOUT_MS', 20_000);
  },

  get strategyOrder(): StrategyName[] {
    return strategyOrder();
  },

  get upstash(): { url: string; token: string } | null {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    return url && token ? { url, token } : null;
  },

  get isConfigured(): boolean {
    return Boolean(this.linkedInCookie && this.csrfToken);
  },
} as const;

function unquote(value: string): string {
  return value.replace(/^"+|"+$/g, '');
}

function quoteJsession(value: string): string {
  const bare = unquote(value);
  return `"${bare}"`;
}
