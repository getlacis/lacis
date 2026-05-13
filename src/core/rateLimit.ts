import { createRateLimitError, sendError } from "@/core/errors";
import type { MiddlewareCallback, Request } from "@/types";

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
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

  const store = new Map<string, RateLimitEntry>();

  return (req, res) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

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

export { createRateLimit };
export type { RateLimitOptions };
