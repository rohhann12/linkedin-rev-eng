import { config } from './config.js';

/**
 * Cache with two backends behind one interface.
 *
 * The cache is not a performance nicety here — it is the main lever protecting
 * the LinkedIn account. Every cache hit is a profile view that never happens,
 * and profile views are the scarce resource: LinkedIn's commercial use limit
 * caps distinct profiles per account per month, and bursts of them are what
 * trigger blocks. A 24-hour TTL on data that changes a few times a year is
 * generous.
 *
 * In-process memory is the default so the service runs with no dependencies.
 * On Vercel each function instance keeps its own map, which is fine but means
 * hit rate depends on instance reuse — so if `UPSTASH_REDIS_REST_URL` is set,
 * a shared Redis is used instead and every instance benefits from every fetch.
 */

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface CacheBackend {
  readonly name: string;
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

const MAX_ENTRIES = 500;

class MemoryCache implements CacheBackend {
  readonly name = 'memory';
  private readonly store = new Map<string, { entry: CacheEntry<unknown>; expiresAt: number }>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const hit = this.store.get(key);
    if (!hit) return null;

    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Refresh recency for the LRU eviction below.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.entry as CacheEntry<T>;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, {
      entry: { value, storedAt: Date.now() },
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Upstash's REST API is used directly rather than through their SDK — it is two
 * fetches, and it keeps the dependency list short enough to audit.
 */
class UpstashCache implements CacheBackend {
  readonly name = 'upstash';
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const response = await this.call(['GET', key]);
    const raw = response?.result;
    if (typeof raw !== 'string') return null;

    try {
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const entry: CacheEntry<T> = { value, storedAt: Date.now() };
    await this.call(['SET', key, JSON.stringify(entry), 'EX', String(ttlSeconds)]);
  }

  async del(key: string): Promise<void> {
    await this.call(['DEL', key]);
  }

  private async call(command: string[]): Promise<{ result?: unknown } | null> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(command),
      });
      if (!response.ok) return null;
      return (await response.json()) as { result?: unknown };
    } catch {
      // A cache outage must never take the API down with it.
      return null;
    }
  }
}

let backend: CacheBackend | null = null;

export function cache(): CacheBackend {
  if (backend) return backend;
  const upstash = config.upstash;
  backend = upstash ? new UpstashCache(upstash.url, upstash.token) : new MemoryCache();
  return backend;
}

/**
 * Cache key. `contact` is part of the key rather than a flag on the entry so
 * that a cached non-contact response can never satisfy a contact request, and
 * personal data is only ever stored under a key a caller explicitly asked for.
 */
export function profileCacheKey(
  publicIdentifier: string,
  options: { deep: boolean; contact: boolean; activity?: boolean },
): string {
  const suffix = [
    options.deep ? 'deep' : 'shallow',
    options.contact ? 'contact' : 'nocontact',
    options.activity ? 'activity' : 'noactivity',
  ];
  return `profile:v1:${publicIdentifier.toLowerCase()}:${suffix.join(':')}`;
}

/** Every cache-key variant for one profile, for targeted purges. */
export function profileCacheKeyVariants(publicIdentifier: string): string[] {
  const keys: string[] = [];
  for (const deep of [false, true]) {
    for (const contact of [false, true]) {
      for (const activity of [false, true]) {
        keys.push(profileCacheKey(publicIdentifier, { deep, contact, activity }));
      }
    }
  }
  return keys;
}
