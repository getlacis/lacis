import { createRateLimitError, sendError } from "@/core/errors";
import type { MiddlewareCallback, Request } from "@/types";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitStore {
  get(key: string): RateLimitEntry | undefined | Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  // Atomic read-modify-write; preferred over get + set so concurrent hits on the
  // same key cannot interleave and undercount, letting the limit be exceeded.
  increment?(key: string, windowMs: number): RateLimitEntry | Promise<RateLimitEntry>;
}

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  store?: RateLimitStore;
  // Trust X-Forwarded-For for the client key. Off by default: it is client-set,
  // so trusting it without a proxy in front lets a client rotate it to get a
  // fresh bucket per request. Enable only behind a proxy that overwrites XFF.
  trustProxy?: boolean;
}

function createInMemoryRateLimitStore(windowMs: number): RateLimitStore {
  const map = new Map<string, RateLimitEntry>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of map) {
      if (now >= entry.resetAt) map.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return {
    get: (key) => map.get(key),
    set: (key, entry) => { map.set(key, entry) },
    delete: (key) => { map.delete(key) },
    increment: (key, win) => {
      const now = Date.now();
      let entry = map.get(key);
      if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + win };
      entry.count++;
      map.set(key, entry);
      return { count: entry.count, resetAt: entry.resetAt }; // snapshot so each caller sees its own count
    },
  };
}

function defaultKeyGenerator(trustProxy: boolean): (req: Request) => string {
  return (req: Request) => {
    if (trustProxy) {
      const forwarded = req.headers["x-forwarded-for"];
      const first = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
      if (first) return first;
    }
    return (req.socket as any)?.remoteAddress ?? "unknown";
  };
}

function createRateLimit(options: RateLimitOptions = {}): MiddlewareCallback {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const message = options.message ?? "Too Many Requests";
  const keyGenerator =
    options.keyGenerator ?? defaultKeyGenerator(options.trustProxy ?? false);

  const store = options.store ?? createInMemoryRateLimitStore(windowMs);

  return async (req, res) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry: RateLimitEntry;
    if (store.increment) {
      entry = await store.increment(key, windowMs);
    } else {
      entry = (await store.get(key)) ?? { count: 0, resetAt: now + windowMs };
      if (now >= entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
      entry.count++;
      await store.set(key, entry);
    }

    const remaining = Math.max(0, max - entry.count);
    const resetSecs = Math.ceil(entry.resetAt / 1000);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSecs));

    if (entry.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((entry.resetAt - now) / 1000))
      );
      sendError(createRateLimitError(message), res);
      return false;
    }
  };
}

export { createRateLimit, createInMemoryRateLimitStore };
export type { RateLimitOptions, RateLimitEntry, RateLimitStore };
