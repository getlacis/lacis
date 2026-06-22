# Lacis

Zero-dependency TypeScript web framework with file-based routing.

> **file-based, multi-runtime, zero-dependency — and a *true-by-construction* OpenAPI contract: validated at the input, typed at the output, generatable as a client.**

**Documentation:** [lacis.lycia.dev](https://lacis.lycia.dev)

## Features

- **File-based routing** — routes generated automatically from your `routes/` folder
- **Standard Schema validation** — validate params, query, and body with Zod, Valibot, or ArkType via `defineHandler`
- **Typed responses** — declare `responses` once: it types the handler *and* feeds the OpenAPI (single source of truth)
- **OpenAPI generation** — spec built automatically from your `defineHandler` routes
- **Middleware** — global, path-scoped (`+middleware.ts`), and per-route/per-method (`use:`)
- **CORS & rate limiting** — built in, zero dependencies
- **SSE** — server-sent events with a matching client helper
- **Multi-platform** — Node.js, Bun, Vercel, Netlify, Cloudflare Workers via adapters
- **Typed request context** — `req.locals` (app data) and `req.platform` (runtime bindings), both augmentable
- **Cookies** — first-class `req.cookies` / `res.cookies` API

## Installation

```bash
npm install lacis
```

## CLI

```bash
lacis dev            # start dev server (auto-detects platform)
lacis build          # generate routes/_manifest.ts
lacis watch          # watch routes and regenerate manifest on changes
```

All commands accept `--routes <dir>` to override the default `./routes` directory.

## Project structure

```
my-app/
  routes/
    +middleware.global.ts  # cascades to all routes
    index.ts               # GET /
    users/
      index.ts             # GET /users, POST /users
      [id]/
        index.ts           # GET /users/:id
    api/
      +middleware.ts       # exact to /api — does NOT cascade
      +middleware.global.ts  # cascades to /api/* and below
      items/
        index.ts
  server.ts
```

## Routing

Each file in `routes/` exports named HTTP method handlers or a default export.

**Named exports**

```ts
// routes/users/index.ts
import type { Request, Response } from 'lacis'

export async function GET(req: Request, res: Response) {
  res.status(200).json({ users: [] })
}

export async function POST(req: Request, res: Response) {
  const body = await req.json()
  res.status(201).json({ created: body })
}
```

**Default export**

```ts
export default async function handler(req: Request, res: Response) {
  res.json({ method: req.method })
}
```

**Dynamic routes**

Use bracket syntax for URL parameters: `routes/users/[id]/index.ts` → `/users/:id`

```ts
export async function GET(req: Request, res: Response) {
  const { id } = req.params!
  res.json({ id })
}
```

## Request / Response API

**Request**

| Property / Method | Description |
|---|---|
| `req.params` | URL path parameters |
| `req.query` | Parsed query string |
| `req.cookies.get(name)` | Read a cookie |
| `req.cookies.all()` | All cookies as an object |
| `req.json<T>()` | Parse JSON body |
| `req.form<T>()` | Parse form body (`multipart/form-data` and `application/x-www-form-urlencoded`) |
| `req.body()` | Raw body as `Buffer` |
| `req.getHeader(name)` | Read a request header |
| `req.locals` | Per-request app context, set by middleware (typed — see below) |
| `req.platform` | Runtime bindings (empty except on Cloudflare — see below) |

**Response**

| Method | Description |
|---|---|
| `res.status(code)` | Set status code (chainable) |
| `res.json(data)` | Send JSON response |
| `res.html(data)` | Send HTML response |
| `res.send(data)` | Send string or JSON |
| `res.redirect(url, status?)` | Redirect to a URL (default 302) |
| `res.setHeader(name, value)` | Set a response header |
| `res.cookies.set(name, value, opts?)` | Set a cookie |
| `res.cookies.delete(name, opts?)` | Delete a cookie |

## defineHandler

`defineHandler` wraps a route handler to add validation and OpenAPI metadata. It supports any library that implements the [Standard Schema](https://standardschema.dev/) spec: Zod 3.24+, Valibot, ArkType.

```ts
// routes/users/[id]/index.ts
import { defineHandler } from 'lacis'
import { z } from 'zod'

export const GET = defineHandler({
  params: z.object({ id: z.string() }),
  query: z.object({ verbose: z.boolean().optional() }),
  meta: { summary: 'Get user by ID', tags: ['users'] },
  handler: async (req, res) => {
    req.params.id      // string — typed and validated
    req.query.verbose  // boolean | undefined — typed and validated
    res.json({ id: req.params.id })
  },
})

export const POST = defineHandler({
  body: z.object({ name: z.string(), email: z.string().email() }),
  meta: { summary: 'Create user', tags: ['users'] },
  handler: async (req, res) => {
    const { name, email } = req.body  // typed
    res.status(201).json({ name, email })
  },
})
```

Validation failures return a `400` automatically:

```json
{
  "error": "Validation failed",
  "issues": [{ "message": "Required", "path": ["email"] }]
}
```

**With Valibot**

```ts
import * as v from 'valibot'

export const GET = defineHandler({
  params: v.object({ id: v.string() }),
  handler: async (req, res) => { ... },
})
```

**With ArkType**

```ts
import { type } from 'arktype'

export const GET = defineHandler({
  query: type({ 'page?': 'number' }),
  handler: async (req, res) => { ... },
})
```

### Typed responses (opt-in)

Declare `responses` and `res` becomes type-safe: `res.status(code).json(data)` only
accepts the schema declared for that status code. This is a single source of truth —
the same `responses` types the handler **and** feeds the OpenAPI spec.

```ts
export const GET = defineHandler({
  responses: {
    200: z.object({ id: z.string(), name: z.string() }),
    404: z.object({ error: z.string() }),
  },
  handler: async (req, res) => {
    res.status(200).json({ id: '1', name: 'Ada' })  // ✓ matches the 200 schema
    res.status(404).json({ id: 1 })                 // ✗ type error — 404 wants { error }
  },
})
```

- **Opt-in & non-breaking**: without `responses`, `res` stays the regular `Response`.
- **Escape hatch**: `res.raw` is the untyped `Response` for streaming / edge cases.
- **Dev-only runtime check**: in non-production (`NODE_ENV !== 'production'`), a returned
  body that violates its declared schema fails loudly. Zero validation in production (perf).

### Per-route middleware (`use:`)

`use:` runs middleware for a single route handler — and because each HTTP method is its
own `defineHandler`, it scopes **by method** (impossible with file-based `+middleware`).
It runs after the path `+middleware`, before the handler. Returning `false` (or sending
the response) stops the chain.

```ts
import { defineHandler } from 'lacis'
import { auth, rateLimit } from '../middleware'

// GET is public, POST requires auth — same path, different methods
export const GET = defineHandler({ handler: async (req, res) => res.json({ list: [] }) })

export const POST = defineHandler({
  use: [rateLimit, auth],
  handler: async (req, res) => res.status(201).json({ ok: true }),
})
```

**Typed context, zero boilerplate.** A `use:` middleware that **returns an object** has it
merged into `req.locals` — and the type is **inferred** for the handler. No annotations, no
`declare module`:

```ts
// middleware: just return what you add to the context
const auth = (req) => {
  const user = verify(req.getHeader('authorization'))
  if (!user) return false            // stops the chain
  return { user }                    // merged into req.locals, type inferred
}

export const GET = defineHandler({
  use: [auth],
  handler: async (req, res) => {
    res.json({ id: req.locals.user.id })  // req.locals.user is fully typed here
  },
})
```

## Request context: `req.locals` and `req.platform`

Both use **declaration merging** — augment them once and they are typed everywhere.

**`req.locals`** — pass application data from middleware to handlers (instead of abusing
headers). Two ways to type it:

- **Per-route (preferred):** return an object from a [`use:`](#per-route-middleware-use)
  middleware — it's merged into `req.locals` and inferred for that handler, no annotations.
- **Global:** for cross-cutting context set by a `+middleware.global.ts`, augment `Locals`
  once (every route then sees the shape — a deliberate trade-off for file-based routing):

```ts
declare module 'lacis' {
  interface Locals {
    user: { id: string; role: string }
  }
}

// in a +middleware file
req.locals.user = await authenticate(req)
// in a handler
res.json({ id: req.locals.user.id })
```

**`req.platform`** — runtime-specific bindings. Empty by default (a Node project exposes
nothing), populated with `{ env, ctx, cf }` on Cloudflare Workers. The Cloudflare scaffold
generates an `env.d.ts` that augments it, so you access `req.platform.env` without `as any`.

```ts
// env.d.ts (Cloudflare)
declare module 'lacis' {
  interface PlatformContext {
    env: Env
    ctx: ExecutionContext
    cf: IncomingRequestCfProperties
  }
}
```

## OpenAPI

Add `openapi` to your server config to expose a generated spec at runtime:

```ts
createServer(routesDir, {
  openapi: {
    path: '/openapi.json',  // default
    info: { title: 'My API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com', description: 'production' }],
  },
})
```

The spec is built from all `defineHandler` routes. Routes without `defineHandler` appear with a generic `200` response. Converters required per library:

| Library | Package to install |
|---|---|
| Zod 4.4+ | none (native) |
| Zod < 4.4 | `zod-to-json-schema` |
| Valibot | `@valibot/to-json-schema` |
| ArkType | none (native `.toJsonSchema()`) |

### Typed client from your spec

Lacis ships **no** client codegen — mature tools do it better, in many languages, and
writing one would betray the zero-dependency ethos. Point [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/)
at your generated spec for an end-to-end typed API client with zero maintained code:

```bash
npx openapi-typescript http://localhost:3000/openapi.json -o ./src/api.d.ts
```

```ts
import createClient from 'openapi-fetch'
import type { paths } from './api'

const api = createClient<paths>({ baseUrl: 'http://localhost:3000' })

// fully typed path, params, body and response
const { data, error } = await api.GET('/users/{id}', { params: { path: { id: '1' } } })
```

## Middleware

There are two file-based middleware conventions (below) for cross-cutting concerns scoped
by **path**, plus per-route/per-method `use:` in `defineHandler` (see [Per-route middleware](#per-route-middleware-use)) for fine-grained scoping. They coexist.

**`+middleware.global.ts` — cascading**

Applies to the current directory and all subdirectories.

```ts
// routes/api/+middleware.global.ts — runs for /api, /api/users, /api/users/:id, etc.
import type { Request, Response } from 'lacis'

export const beforeRequest = async (req: Request, res: Response) => {
  if (!req.getHeader('authorization')) {
    res.status(401).json({ error: 'Unauthorized' })
    return false  // stops the request
  }
}

export const afterRequest = async (req: Request, res: Response) => {
  // runs after the handler
}

export const onError = async (req: Request, res: Response, context: any) => {
  console.error(context.error)
}
```

**`+middleware.ts` — exact path only**

Applies only to routes at that directory level. Does **not** cascade into subdirectories.

```ts
// routes/api/+middleware.ts — runs for /api only, NOT /api/users
import type { Request, Response } from 'lacis'

export const beforeRequest = async (req: Request, res: Response) => {
  // ...
}
```

Returning `false` from `beforeRequest` stops the request pipeline.

**Global middleware via server config**

```ts
createServer(routesDir, {
  middleware: {
    beforeRequest: async (req, res) => { /* ... */ },
    afterRequest: async (req, res) => { /* ... */ },
    onError: async (req, res, ctx) => { /* ... */ },
  },
})
```

## Lifecycle hooks

```ts
createServer(routesDir, {
  hooks: {
    onNotFound: async (req, res) => {
      res.status(404).json({ error: 'Not found', path: req.url })
    },

    onShutdown: async () => {
      // close DB connections, flush logs, etc.
    },
  },
})
```

`onNotFound` is called when no route matches. If it sends a response, the default `404` is skipped. If it returns without sending, the default `{ error: "Not Found", code: 404 }` is used.

`onShutdown` is called during graceful shutdown (SIGINT / SIGTERM / SIGHUP), before the server closes.

## CORS

```ts
createServer(routesDir, {
  cors: {
    origin: 'https://myapp.com',  // string, string[], RegExp, or (origin) => boolean
    credentials: true,
    methods: ['GET', 'POST'],     // default: all methods
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 86400,
  },
})
```

`origin: '*'` is incompatible with `credentials: true` — Lacis reflects the actual origin automatically in that case.

You can also create a standalone middleware:

```ts
import { createCorsMiddleware } from 'lacis'

const cors = createCorsMiddleware({ origin: '*' })
```

## Rate limiting

```ts
import { createRateLimit } from 'lacis'

createServer(routesDir, {
  middleware: {
    beforeRequest: createRateLimit({
      windowMs: 60_000,   // 1 minute
      max: 100,
      message: 'Too Many Requests',
      keyGenerator: (req) => req.getHeader('x-forwarded-for') ?? 'unknown',
    }),
  },
})
```

Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers on every response. Returns `429` with `Retry-After` when the limit is exceeded.

## Server-Sent Events

**Server**

```ts
// routes/stream/index.ts
import type { Request, Response } from 'lacis'

export async function GET(req: Request, res: Response) {
  const sse = res.initSSE()

  sse.json({ status: 'connected' })
  sse.event('update', { id: 1, value: 42 })
  sse.close()
}
```

`res.initSSE(options?)` returns an `SSEContext` object:

| Method | Description |
|---|---|
| `sse.send(data)` | Send raw string data |
| `sse.json(data)` | Send JSON data |
| `sse.event(event, data)` | Send named event with JSON data |
| `sse.comment(text)` | Send a comment (keepalive) |
| `sse.id(id)` | Set event ID |
| `sse.retry(ms)` | Set client retry interval |
| `sse.close(comment?)` | Close the connection |
| `sse.error(event, message, code?, details?)` | Send error event and close |

**Bun & Cloudflare: call `initSSE()` before any `await`**

On the runtime-Web adapters (**Bun** and **Cloudflare Workers**), the response type
(streaming vs buffered) must be decided synchronously before the first `await`. Calling
`initSSE()` after an `await` throws at runtime.

```ts
// ✗ throws on Bun / Cloudflare
export async function GET(req: Request, res: Response) {
  const data = await fetchData()
  const sse = res.initSSE()  // too late — streaming window already closed
}

// ✓ init before any await, then fetch
export async function GET(req: Request, res: Response) {
  const sse = res.initSSE()
  const data = await fetchData()
  sse.json(data)
  sse.close()
}
```

Once the handler's first `await` resolves, the streaming decision is final. Node.js, Vercel,
and Netlify do not have this constraint.

**Client**

```ts
import { createSSEClient } from 'lacis'

const client = await createSSEClient('http://localhost:3000/stream')

client
  .onMessage(data => console.log('message:', data))
  .onEvent('update', data => console.log('update:', data))
  .onClose(() => console.log('closed'))
```

`createSSEClient` options:

```ts
createSSEClient(url, {
  method: 'GET',           // default GET, POST if body is provided
  body: { token: 'abc' },  // sent as JSON if provided
  reconnectInterval: 3000,
  maxRetries: 3,
  disableReconnect: false,
  params: { key: 'value' }, // appended to URL query string
})
```

## Server configuration

```ts
import { createServer } from 'lacis'

createServer(routesDir, {
  port: 3000,
  isDev: process.env.NODE_ENV === 'development',
  platform: 'node',            // 'node' | 'bun' | 'vercel' | 'netlify' | 'cloudflare'
  timeout: 30000,
  maxBodySize: 10_485_760,     // max request body in bytes (default 10 MB; 413 when exceeded)

  defaultHeaders: {            // applied on node, bun and cloudflare
    'X-Powered-By': 'Lacis',
  },

  httpsOptions: {
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem'),
  },

  cluster: {
    enabled: true,
    workers: 4,  // defaults to CPU count
    // Node: fork-based cluster, OS round-robin scheduling
    // Bun:  Bun.spawn() workers with reusePort
  },

  // Dev only — exposes /health endpoint with request metrics
  monitoring: {
    enabled: true,
    sampleInterval: 5000,
    reportInterval: 60000,
    thresholds: {
      cpu: 80,
      memory: 80,
      responseTime: 1000,
      errorRate: 5,
    },
  },
})
```

## Adapters

```ts
import { createServer, getRoutesDir } from 'lacis'

// Node.js
createServer(getRoutesDir(), { platform: 'node' })

// Bun
createServer(getRoutesDir(), { platform: 'bun' })

// Vercel
export default createServer(getRoutesDir(), { platform: 'vercel' })

// Netlify
export const handler = createServer(getRoutesDir(), { platform: 'netlify' })
```

Cloudflare Workers use the serverless manifest directly:

```ts
// worker.ts
import { cloudflareAdapter } from 'lacis/adapters'
import { routes } from './routes/_manifest.js'

export default cloudflareAdapter.createHandler({ routes })
```

## Runtime behavior & constraints

Lacis runs on five runtimes; a few behaviors differ by necessity. These are stable and
intentional.

| Behavior | node | bun | cloudflare | vercel | netlify |
|---|---|---|---|---|---|
| **Streaming** (`res.stream` / SSE) | live | live | live | buffered | buffered |
| **`initSSE()` before first `await`** | not required | required | required | not required | not required |
| **`defaultHeaders`** | ✓ | ✓ | ✓ | — | — |
| **`req.platform`** | `{}` | `{}` | `{ env, ctx, cf }` | `{}` | `{}` |
| **405 `Allow` header** | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Streaming live vs buffered**: node, bun and cloudflare stream chunks as they are produced;
  vercel and netlify buffer the whole response and send it in one block (their function model).
  Cloudflare is serverless but streams *live* because it uses the Web Response model.
- **Request distribution (node cluster)**: handled by the OS via round-robin (`SCHED_RR`).
  Lacis does **not** do application-level load balancing — the worker supervisor only forks,
  restarts, and gracefully shuts down workers.
- **SSE window**: on bun/cloudflare, `initSSE()` must run before the handler's first `await`
  (see the SSE section).

## License

MIT
