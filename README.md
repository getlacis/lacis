# Lacis

Zero-dependency TypeScript web framework with file-based routing.

## Features

- **File-based routing** — routes generated automatically from your `routes/` folder
- **Standard Schema validation** — validate params, query, and body with Zod, Valibot, or ArkType via `defineHandler`
- **OpenAPI generation** — spec built automatically from your `defineHandler` routes
- **Middleware** — global, path-scoped, and route-scoped via `+middleware.ts` files
- **CORS & rate limiting** — built in, zero dependencies
- **SSE** — server-sent events with a matching client helper
- **Multi-platform** — Node.js, Bun, Vercel, Netlify via adapters
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
    +middleware.ts        # global middleware
    index.ts              # GET /
    users/
      index.ts            # GET /users, POST /users
      [id]/
        index.ts          # GET /users/:id
    api/
      +middleware.ts      # middleware scoped to /api/*
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
| `req.form<T>()` | Parse form body |
| `req.body()` | Raw body as `Buffer` |
| `req.getHeader(name)` | Read a request header |

**Response**

| Method | Description |
|---|---|
| `res.status(code)` | Set status code (chainable) |
| `res.json(data)` | Send JSON response |
| `res.send(data)` | Send string or JSON |
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

## OpenAPI

Add `openapi` to your server config to expose a generated spec at runtime:

```ts
createServer(routesDir, {
  openapi: {
    path: '/openapi.json',  // default
    info: { title: 'My API', version: '1.0.0' },
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

## Middleware

Create a `+middleware.ts` file in any route directory. It applies to all routes at and below that path.

```ts
// routes/api/+middleware.ts
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
  res.initSSE()

  res.sseJson({ status: 'connected' })
  res.sseEvent('update', { id: 1, value: 42 })
  res.sseClose()
}
```

| Method | Description |
|---|---|
| `res.initSSE(options?)` | Initialize SSE response |
| `res.sseSend(data)` | Send raw string data |
| `res.sseJson(data)` | Send JSON data |
| `res.sseEvent(event, data)` | Send named event with JSON data |
| `res.sseComment(comment)` | Send a comment (keepalive) |
| `res.sseId(id)` | Set event ID |
| `res.sseRetry(ms)` | Set client retry interval |
| `res.sseClose(comment?)` | Close the connection |

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
  platform: 'node',            // 'node' | 'bun' | 'vercel' | 'netlify'
  timeout: 30000,

  defaultHeaders: {
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

## License

MIT
