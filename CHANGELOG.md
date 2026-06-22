# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased] — 0.5.0 (hardening for 1.0)

A hardening pass ahead of 1.0. Several items are intentionally breaking now (before the
1.0 semver freeze) rather than after it.

### Added

- **Typed responses** in `defineHandler`: declaring `responses` narrows `res` so
  `res.status(code).json(data)` only accepts the schema for that status code. Same
  `responses` feeds the OpenAPI spec (single source of truth). Escape hatch: `res.raw`.
  Dev-only runtime validation (`NODE_ENV !== 'production'`); zero validation in production.
- **`req.locals`** — typed, augmentable per-request app context (declaration merging).
- **`req.platform`** — typed, augmentable runtime bindings; populated with `{ env, ctx, cf }`
  on Cloudflare, empty elsewhere.
- **Per-route middleware** `use: [...]` in `defineHandler`, scoped by method. A middleware
  that returns an object has it merged into `req.locals` with the type inferred for the
  handler — typed per-route context with no annotations or declaration merging.
- **Cloudflare Workers adapter** built on the shared Web adapter base (live streaming).
- **`application/x-www-form-urlencoded`** support in `req.form()` (in addition to multipart).
- **`maxBodySize`** server option (default 10 MB), propagated to all adapters.
- **`Allow` header** emitted on every `405 Method Not Allowed`, across all adapters.
- **OpenAPI `servers`** field in the server `openapi` config.
- `defaultHeaders` now applied on Cloudflare as well (node/bun/cloudflare).

### Changed

- **BREAKING** `createLoadBalancer` renamed to `createWorkerSupervisor`
  (`src/utils/workerSupervisor.ts`). The name now reflects the behavior: it supervises
  cluster workers; request distribution is the OS's job (round-robin `SCHED_RR`).
- **BREAKING** `req.env` / `req.ctx` / `req.cf` removed from the root `Request`; runtime
  context now lives under `req.platform`.
- Consolidated the triplicated max-body-size constant into a single `DEFAULT_MAX_BODY_SIZE`.
- Factored a shared `WebApiRequestBase` for the Bun and Cloudflare adapters.
- Standardized route-error detection on `isRouteError` across all adapters.

### Removed

- Unused per-worker stats reporting (`reportStats` / `stats` message plumbing) and the
  `loadBalancer` types. The supervisor exposes only `start` / `shutdown` /
  `getActiveWorkerCount`.

### Fixed

- OpenAPI `servers` config option was generated but missing from the public type.
- Residual French comments cleaned up across the source.

### Notes

- Per the product decision, 1.0 is **not** tagged yet. The only remaining 1.0 gate is the
  version bump + semver surface freeze + the `1.0.0` tag — deferred until you decide to cut it.
  (The Express migration guide and feature docs are already written.)
