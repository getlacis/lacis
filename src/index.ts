// Public API surface. Everything re-exported here is the supported, semver-frozen
// API. Internal machinery (the router and middleware registries, response-cache
// store plumbing, error normalization, OpenAPI doc builder) is intentionally not
// re-exported — the built-in adapters consume it via deep imports.

// Server & config
export { createServer } from "@/core/server";
export { getConfig } from "@/config/serverConfig";

// Route handlers, validation & typed responses
export * from "@/core/defineHandler";

// Project layout
export { getRoutesDir } from "@/core/router";

// Middleware factories
export { createCorsMiddleware } from "@/core/cors";
export * from "@/core/rateLimit";
export { createResponseCache, withCache, defaultCacheKey } from "@/core/responseCache";
export type {
  ResponseCacheOptions,
  WithCacheOptions,
  CacheEntry,
  CacheStore,
} from "@/core/responseCache";

// Streaming & SSE
export { parseNDJSON } from "@/core/streaming";
export { initSSE } from "@/sse/server";
export * from "@/sse/client";

// HTTP errors
export {
  HTTP_STATUS,
  createHttpError,
  isHttpError,
  sendError,
  createBadRequestError,
  createUnauthorizedError,
  createForbiddenError,
  createNotFoundError,
  createMethodNotAllowedError,
  createConflictError,
  createValidationError,
  createRateLimitError,
  createInternalServerError,
  createServiceUnavailableError,
  createGatewayTimeoutError,
} from "@/core/errors";

// Public types (incl. the augmentation targets Locals / PlatformContext)
export * from "@/types/index";
