import { config } from '../config.js';
import { ApiError } from '../errors.js';

/**
 * A thin authenticated HTTP client for LinkedIn's internal endpoints.
 *
 * Two responsibilities beyond "send the request":
 *  1. Reproduce the header set the web client sends. Voyager rejects requests
 *     that are missing `csrf-token`, `x-restli-protocol-version` or a plausible
 *     `x-li-track`, so these are not optional decoration.
 *  2. Translate LinkedIn's failure vocabulary into our error taxonomy, which
 *     is what makes the fetcher chain able to decide "retry elsewhere" versus
 *     "stop, the session is dead".
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const LI_TRACK = JSON.stringify({
  clientVersion: '1.13.46243',
  mpVersion: '1.13.46243',
  osName: 'web',
  timezoneOffset: 5.5,
  timezone: 'Asia/Calcutta',
  deviceFormFactor: 'DESKTOP',
  mpName: 'voyager-web',
  displayDensity: 2,
  displayWidth: 3326,
  displayHeight: 2160,
});

export const ACCEPT_NORMALIZED = 'application/vnd.linkedin.normalized+json+2.1';
export const ACCEPT_GRAPHQL = 'application/graphql';
export const ACCEPT_HTML =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

export interface RequestOptions {
  accept?: string;
  referer?: string;
  /** Skip the politeness delay — used only by the session health check. */
  immediate?: boolean;
}

/**
 * Serialises upstream traffic and keeps a floor between consecutive requests.
 * A single profile lookup fans out into several sub-resource calls; without
 * this they would leave in one burst, which is exactly the pattern LinkedIn
 * throttles on.
 */
class UpstreamThrottle {
  private tail: Promise<void> = Promise.resolve();
  private lastAt = 0;

  run<T>(task: () => Promise<T>, immediate = false): Promise<T> {
    const scheduled = this.tail.then(async () => {
      if (!immediate) {
        const minInterval = config.upstreamMinIntervalMs;
        const waitFor = this.lastAt + minInterval - Date.now();
        if (waitFor > 0) await sleep(waitFor + jitter(minInterval));
      }
      this.lastAt = Date.now();
    });

    this.tail = scheduled.catch(() => undefined);
    return scheduled.then(task);
  }
}

const throttle = new UpstreamThrottle();

export interface RawResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
}

export async function requestRaw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  if (!config.isConfigured) {
    throw new ApiError(
      'SESSION_MISSING',
      'No LinkedIn session configured. Set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID (or LINKEDIN_COOKIE).',
    );
  }

  const url = path.startsWith('http') ? path : `https://www.linkedin.com${path}`;

  return throttle.run(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: buildHeaders(options),
      });

      const body = await response.text();
      const raw: RawResponse = {
        status: response.status,
        url: response.url,
        headers: response.headers,
        body,
      };

      assertUsable(raw);
      return raw;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError('UPSTREAM_TIMEOUT', `Timed out after ${config.fetchTimeoutMs}ms: ${url}`);
      }
      throw new ApiError('UPSTREAM_BLOCKED', `Network failure calling LinkedIn: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }, options.immediate);
}

/** Same as {@link requestRaw} but parses the body as JSON. */
export async function requestJson<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const raw = await requestRaw(path, { accept: ACCEPT_NORMALIZED, ...options });
  try {
    return JSON.parse(raw.body) as T;
  } catch {
    throw new ApiError('UNEXPECTED_PAYLOAD', `Response from ${path} was not JSON.`, {
      preview: raw.body.slice(0, 200),
    });
  }
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  return {
    accept: options.accept ?? ACCEPT_NORMALIZED,
    'accept-language': 'en-US,en;q=0.9',
    cookie: config.linkedInCookie,
    'csrf-token': config.csrfToken,
    referer: options.referer ?? 'https://www.linkedin.com/feed/',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': USER_AGENT,
    'x-li-lang': 'en_US',
    'x-li-track': LI_TRACK,
    'x-restli-protocol-version': '2.0.0',
  };
}

/**
 * Maps LinkedIn's responses onto our error codes. The distinctions matter: an
 * expired cookie must not be retried against another strategy (they all share
 * the same session), whereas a 999 or a timeout should be.
 */
function assertUsable(raw: RawResponse): void {
  const { status, url, body } = raw;

  if (status === 999) {
    throw new ApiError('UPSTREAM_BLOCKED', 'LinkedIn returned 999 (automation defence tripped).');
  }

  if (/\/(uas\/login|authwall|checkpoint\/)/.test(url)) {
    throw new ApiError('AUTH_WALL', 'LinkedIn redirected to the login wall or a checkpoint.', {
      redirectedTo: url,
    });
  }

  if (status === 401 || /CSRF check failed/i.test(body)) {
    throw new ApiError(
      'SESSION_EXPIRED',
      'LinkedIn rejected the session. Re-seed li_at and JSESSIONID.',
    );
  }

  if (status === 403) {
    throw new ApiError('PROFILE_NOT_VISIBLE', 'LinkedIn refused access to this resource (403).');
  }

  if (status === 404) {
    throw new ApiError('PROFILE_NOT_FOUND', 'LinkedIn has no such profile (404).');
  }

  if (status === 429) {
    throw new ApiError('UPSTREAM_BLOCKED', 'LinkedIn rate-limited the session (429).');
  }

  if (status >= 500) {
    throw new ApiError('UPSTREAM_BLOCKED', `LinkedIn returned ${status}.`);
  }

  if (status >= 400) {
    throw new ApiError('UNEXPECTED_PAYLOAD', `LinkedIn returned ${status}.`, {
      preview: body.slice(0, 200),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small randomisation so the request cadence is not perfectly periodic. */
function jitter(base: number): number {
  return Math.floor(Math.random() * Math.max(1, Math.round(base * 0.25)));
}
