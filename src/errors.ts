/**
 * A closed set of failure modes. Every error the API can return maps onto one
 * of these codes, so callers can branch on `error.code` instead of parsing
 * prose or guessing from a status line.
 */
export const ERROR_CODES = {
  /** The supplied string is not a LinkedIn member profile URL. */
  INVALID_URL: { status: 400, retryable: false },
  /** Request rejected before it reached the extraction pipeline. */
  UNAUTHORIZED: { status: 401, retryable: false },
  /** Caller exceeded their own quota. */
  RATE_LIMITED: { status: 429, retryable: true },
  /** LinkedIn returned 404, or the vanity name no longer resolves. */
  PROFILE_NOT_FOUND: { status: 404, retryable: false },
  /** Profile exists but the session's viewer cannot see it (private/blocked). */
  PROFILE_NOT_VISIBLE: { status: 403, retryable: false },
  /** LinkedIn served the logged-out interstitial: the session is not applied. */
  AUTH_WALL: { status: 502, retryable: true },
  /** Cookies are present but rejected: expired li_at or CSRF mismatch. */
  SESSION_EXPIRED: { status: 503, retryable: false },
  /** No session material configured at all. */
  SESSION_MISSING: { status: 503, retryable: false },
  /** LinkedIn's anti-automation response (HTTP 999) or a hard block. */
  UPSTREAM_BLOCKED: { status: 502, retryable: true },
  /** Upstream took too long. */
  UPSTREAM_TIMEOUT: { status: 504, retryable: true },
  /** Every configured strategy ran and none produced a usable payload. */
  ALL_STRATEGIES_FAILED: { status: 502, retryable: true },
  /** Payload arrived but did not match the shape we know how to read. */
  UNEXPECTED_PAYLOAD: { status: 502, retryable: false },
  INTERNAL: { status: 500, retryable: false },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.retryable = ERROR_CODES[code].retryable;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/** Narrow an unknown thrown value into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Error && err.name === 'AbortError') {
    return new ApiError('UPSTREAM_TIMEOUT', 'Upstream request timed out.');
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError('INTERNAL', message);
}
