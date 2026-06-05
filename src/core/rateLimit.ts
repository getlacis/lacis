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
}

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  store?: RateLimitStore;
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
  };
}

function createRateLimit(options: RateLimitOptions = {}): MiddlewareCallback {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const message = options.message ?? "Too Many Requests";
  const keyGenerator =
    options.keyGenerator ??
    ((req: Request) => {
      const forwarded = req.headers["x-forwarded-for"];
      return (
        (typeof forwarded === "string"
          ? forwarded.split(",")[0].trim()
          : (req.socket as any)?.remoteAddress) ?? "unknown"
      );
    });

  const store = options.store ?? createInMemoryRateLimitStore(windowMs);

  return async (req, res) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = await store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
    }

    entry.count++;
    await store.set(key, entry);

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
