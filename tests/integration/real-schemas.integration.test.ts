import http from 'http'
import { IncomingMessage } from 'http'
import supertest from 'supertest'
import { z } from 'zod'
import * as v from 'valibot'
import { type } from 'arktype'
import { defineHandler } from '@/core/defineHandler'
import { buildOpenApiDoc } from '@/core/openapi'
import { findRoute, registerRoutes, resetRouter, router } from '@/core/router'
import { resetMiddlewares } from '@/core/middleware'
import { nodeBody, withRequestMethods, withResponseMethods } from '@/utils/adapter-base'
import type { ServerlessRoute } from '@/types'

class _ReqBase extends IncomingMessage {
  params: Record<string, string> = {}
  body = nodeBody
}
class TestRequest extends withRequestMethods(_ReqBase) {}
class TestResponse extends withResponseMethods(http.ServerResponse<TestRequest>) {}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?')
  if (idx === -1) return {}
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)).entries())
}

function createApp(routes: ServerlessRoute[]) {
  resetRouter()
  resetMiddlewares()
  registerRoutes(routes)

  const server = http.createServer<typeof TestRequest, typeof TestResponse>(
    { IncomingMessage: TestRequest, ServerResponse: TestResponse },
    async (req, res) => {
      try {
        const rawUrl = req.url ?? '/'
        const pathname = rawUrl.includes('?') ? rawUrl.slice(0, rawUrl.indexOf('?')) : rawUrl
        ;(req as any).query = parseQuery(rawUrl)

        const route = findRoute(pathname, req.method ?? 'GET')
        if (!route) { res.status(404).json({ error: 'Not found' }); return }
        if ('error' in route) { res.status((route as any).status ?? 500).json({ error: (route as any).error }); return }

        req.params = route.params
        await route.handler(req as any, res as any)
        if (!res.headersSent) res.end()
      } catch {
        if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' })
      }
    },
  )

  return supertest(server)
}

// ─── Zod ─────────────────────────────────────────────────────────────────────

describe('defineHandler — Zod schemas', () => {
  describe('params', () => {
    it('accepts valid params', async () => {
      const app = createApp([{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({
            params: z.object({ id: z.string() }),
            handler: async (req, res) => res.status(200).json({ id: (req.params as any).id }),
          }),
        },
      }])
      await app.get('/users/abc').expect(200).expect({ id: 'abc' })
    })

    it('rejects invalid params with 400', async () => {
      const app = createApp([{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({
            params: z.object({ id: z.string().uuid() }),
            handler: async (_req, res) => res.status(200).json({}),
          }),
        },
      }])
      const { body } = await app.get('/users/not-a-uuid').expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues[0].message).toBeTruthy()
    })
  })

  describe('query', () => {
    it('coerces and validates query params', async () => {
      const app = createApp([{
        path: '/items',
        handlers: {
          GET: defineHandler({
            query: z.object({ page: z.coerce.number().int().positive() }),
            handler: async (req, res) => res.status(200).json({ page: (req.query as any).page }),
          }),
        },
      }])
      await app.get('/items?page=3').expect(200).expect({ page: 3 })
    })

    it('rejects invalid query with 400', async () => {
      const app = createApp([{
        path: '/items',
        handlers: {
          GET: defineHandler({
            query: z.object({ page: z.coerce.number().int().positive() }),
            handler: async (_req, res) => res.status(200).json({}),
          }),
        },
      }])
      const { body } = await app.get('/items?page=-1').expect(400)
      expect(body.error).toBe('Validation failed')
    })
  })

  describe('body', () => {
    it('accepts valid body', async () => {
      const app = createApp([{
        path: '/users',
        handlers: {
          POST: defineHandler({
            body: z.object({ name: z.string(), age: z.number().int().positive() }),
            handler: async (req, res) => res.status(201).json((req as any).body),
          }),
        },
      }])
      await app.post('/users').set('Content-Type', 'application/json').send({ name: 'alice', age: 25 }).expect(201).expect({ name: 'alice', age: 25 })
    })

    it('rejects body with missing required field', async () => {
      const app = createApp([{
        path: '/users',
        handlers: {
          POST: defineHandler({
            body: z.object({ name: z.string() }),
            handler: async (_req, res) => res.status(201).json({}),
          }),
        },
      }])
      const { body } = await app.post('/users').set('Content-Type', 'application/json').send({}).expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues.length).toBeGreaterThan(0)
    })
  })
})

// ─── Valibot ──────────────────────────────────────────────────────────────────

describe('defineHandler — Valibot schemas', () => {
  describe('params', () => {
    it('accepts valid params', async () => {
      const app = createApp([{
        path: '/posts/:slug',
        handlers: {
          GET: defineHandler({
            params: v.object({ slug: v.string() }),
            handler: async (req, res) => res.status(200).json({ slug: (req.params as any).slug }),
          }),
        },
      }])
      await app.get('/posts/hello-world').expect(200).expect({ slug: 'hello-world' })
    })
  })

  describe('body', () => {
    it('accepts valid body', async () => {
      const app = createApp([{
        path: '/contact',
        handlers: {
          POST: defineHandler({
            body: v.object({ email: v.pipe(v.string(), v.email()), message: v.string() }),
            handler: async (req, res) => res.status(200).json((req as any).body),
          }),
        },
      }])
      await app.post('/contact').set('Content-Type', 'application/json').send({ email: 'user@example.com', message: 'hi' }).expect(200).expect({ email: 'user@example.com', message: 'hi' })
    })

    it('rejects invalid email with 400', async () => {
      const app = createApp([{
        path: '/contact',
        handlers: {
          POST: defineHandler({
            body: v.object({ email: v.pipe(v.string(), v.email()) }),
            handler: async (_req, res) => res.status(200).json({}),
          }),
        },
      }])
      const { body } = await app.post('/contact').set('Content-Type', 'application/json').send({ email: 'not-an-email' }).expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues[0].message).toBeTruthy()
    })

    it('rejects missing required field with 400', async () => {
      const app = createApp([{
        path: '/contact',
        handlers: {
          POST: defineHandler({
            body: v.object({ name: v.string() }),
            handler: async (_req, res) => res.status(200).json({}),
          }),
        },
      }])
      const { body } = await app.post('/contact').set('Content-Type', 'application/json').send({}).expect(400)
      expect(body.error).toBe('Validation failed')
    })
  })
})

// ─── ArkType ─────────────────────────────────────────────────────────────────

describe('defineHandler — ArkType schemas', () => {
  describe('params', () => {
    it('accepts valid params', async () => {
      const app = createApp([{
        path: '/products/:id',
        handlers: {
          GET: defineHandler({
            params: type({ id: 'string' }),
            handler: async (req, res) => res.status(200).json({ id: (req.params as any).id }),
          }),
        },
      }])
      await app.get('/products/42').expect(200).expect({ id: '42' })
    })
  })

  describe('body', () => {
    it('accepts valid body', async () => {
      const app = createApp([{
        path: '/orders',
        handlers: {
          POST: defineHandler({
            body: type({ quantity: 'number > 0', item: 'string' }),
            handler: async (req, res) => res.status(201).json((req as any).body),
          }),
        },
      }])
      await app.post('/orders').set('Content-Type', 'application/json').send({ quantity: 3, item: 'widget' }).expect(201).expect({ quantity: 3, item: 'widget' })
    })

    it('rejects invalid body with 400', async () => {
      const app = createApp([{
        path: '/orders',
        handlers: {
          POST: defineHandler({
            body: type({ quantity: 'number', item: 'string' }),
            handler: async (_req, res) => res.status(201).json({}),
          }),
        },
      }])
      // sends item as a number instead of string
      const { body } = await app.post('/orders').set('Content-Type', 'application/json').send({ quantity: 3, item: 42 }).expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues[0].message).toBeTruthy()
    })
  })
})

// ─── OpenAPI — Zod ───────────────────────────────────────────────────────────

describe('buildOpenApiDoc — Zod schemas', () => {
  const info = { title: 'Test', version: '1.0.0' }

  beforeEach(() => { resetRouter(); resetMiddlewares() })

  it('generates path parameters from Zod params schema', async () => {
    router.addRoute('GET', '/users/[id]', defineHandler({
      params: z.object({ id: z.string() }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const params = doc.paths['/users/{id}'].get.parameters
    expect(params).toContainEqual(expect.objectContaining({ name: 'id', in: 'path', required: true }))
  })

  it('generates query parameters with required flag from Zod schema', async () => {
    router.addRoute('GET', '/search', defineHandler({
      query: z.object({ q: z.string(), page: z.number().optional() }),
      handler: async (_req, res) => res.json([]),
    }))
    const doc = await buildOpenApiDoc({ info })
    const params = doc.paths['/search'].get.parameters
    const qParam = params.find((p: any) => p.name === 'q')
    const pageParam = params.find((p: any) => p.name === 'page')
    expect(qParam.required).toBe(true)
    expect(pageParam.required).toBe(false)
  })

  it('generates requestBody from Zod body schema', async () => {
    router.addRoute('POST', '/users', defineHandler({
      body: z.object({ name: z.string(), age: z.number() }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const op = doc.paths['/users'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.required).toBe(true)
    expect(op.requestBody.content['application/json'].schema.properties.name).toBeDefined()
    expect(op.requestBody.content['application/json'].schema.properties.age).toBeDefined()
  })
})

// ─── OpenAPI — Valibot ───────────────────────────────────────────────────────

describe('buildOpenApiDoc — Valibot schemas', () => {
  const info = { title: 'Test', version: '1.0.0' }

  beforeEach(() => { resetRouter(); resetMiddlewares() })

  it('generates path parameters from Valibot params schema', async () => {
    router.addRoute('GET', '/posts/[slug]', defineHandler({
      params: v.object({ slug: v.string() }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const params = doc.paths['/posts/{slug}'].get.parameters
    expect(params).toContainEqual(expect.objectContaining({ name: 'slug', in: 'path', required: true }))
  })

  it('generates requestBody from Valibot body schema', async () => {
    router.addRoute('POST', '/contact', defineHandler({
      body: v.object({ email: v.string(), message: v.string() }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const op = doc.paths['/contact'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.content['application/json'].schema.properties.email).toBeDefined()
  })
})

// ─── OpenAPI — ArkType ───────────────────────────────────────────────────────

describe('buildOpenApiDoc — ArkType schemas', () => {
  const info = { title: 'Test', version: '1.0.0' }

  beforeEach(() => { resetRouter(); resetMiddlewares() })

  it('generates path parameters from ArkType params schema', async () => {
    router.addRoute('GET', '/products/[id]', defineHandler({
      params: type({ id: 'string' }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const params = doc.paths['/products/{id}'].get.parameters
    expect(params).toContainEqual(expect.objectContaining({ name: 'id', in: 'path', required: true }))
  })

  it('generates requestBody from ArkType body schema', async () => {
    router.addRoute('POST', '/orders', defineHandler({
      body: type({ quantity: 'number', item: 'string' }),
      handler: async (_req, res) => res.json({}),
    }))
    const doc = await buildOpenApiDoc({ info })
    const op = doc.paths['/orders'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.content['application/json'].schema.properties.quantity).toBeDefined()
  })
})
