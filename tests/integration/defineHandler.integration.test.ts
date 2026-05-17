import { defineHandler } from '@/core/defineHandler'
import { okSchema, failSchema } from '../helpers/schemas'
import { createTestApp } from './helpers/server'

describe('defineHandler integration', () => {
  describe('params validation', () => {
    it('responds 200 with validated params', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({
            params: okSchema((v) => ({ ...(v as object), id: (v as any).id.toUpperCase() })),
            handler: async (req, res) => { res.status(200).json({ id: (req.params as any).id }) },
          }),
        },
      }] })
      await request.get('/users/abc').expect(200).expect({ id: 'ABC' })
      await close()
    })

    it('responds 400 when params schema fails', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({
            params: failSchema('id must be a UUID'),
            handler: async (_req, res) => { res.status(200).json({ ok: true }) },
          }),
        },
      }] })
      const { body } = await request.get('/users/not-a-uuid').expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues[0].message).toBe('id must be a UUID')
      await close()
    })

    it('handler is never called when params validation fails', async () => {
      const handlerSpy = jest.fn()
      const { request, close } = await createTestApp({ routes: [{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({ params: failSchema('bad'), handler: handlerSpy }),
        },
      }] })
      await request.get('/users/123').expect(400)
      expect(handlerSpy).not.toHaveBeenCalled()
      await close()
    })
  })

  describe('query validation', () => {
    it('responds 200 with validated query', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/search',
        handlers: {
          GET: defineHandler({
            query: okSchema((v) => ({ page: parseInt((v as any).page ?? '1', 10) })),
            handler: async (req, res) => { res.status(200).json({ page: (req.query as any).page }) },
          }),
        },
      }] })
      await request.get('/search?page=3').expect(200).expect({ page: 3 })
      await close()
    })

    it('responds 400 when query schema fails', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/search',
        handlers: {
          GET: defineHandler({
            query: failSchema('page is invalid'),
            handler: async (_req, res) => { res.status(200).json({ ok: true }) },
          }),
        },
      }] })
      const { body } = await request.get('/search?page=abc').expect(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues[0].message).toBe('page is invalid')
      await close()
    })

    it('receives empty object when no query string is provided', async () => {
      let received: unknown
      const { request, close } = await createTestApp({ routes: [{
        path: '/search',
        handlers: {
          GET: defineHandler({
            query: okSchema(),
            handler: async (req, res) => { received = req.query; res.status(200).json({}) },
          }),
        },
      }] })
      await request.get('/search').expect(200)
      expect(received).toEqual({})
      await close()
    })
  })

  describe('body validation', () => {
    it('responds 200 with validated body', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/users',
        handlers: {
          POST: defineHandler({
            body: okSchema(),
            handler: async (req, res) => { res.status(201).json((req as any).body) },
          }),
        },
      }] })
      await request.post('/users').set('Content-Type', 'application/json').send({ name: 'lacis' }).expect(201).expect({ name: 'lacis' })
      await close()
    })

    it('responds 400 when body schema fails', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/users',
        handlers: {
          POST: defineHandler({
            body: failSchema('name is required'),
            handler: async (_req, res) => { res.status(201).json({}) },
          }),
        },
      }] })
      const { body } = await request.post('/users').set('Content-Type', 'application/json').send({}).expect(400)
      expect(body.issues[0].message).toBe('name is required')
      await close()
    })

    it('responds 400 when body is not valid JSON', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/users',
        handlers: {
          POST: defineHandler({
            body: okSchema(),
            handler: async (_req, res) => { res.status(201).json({}) },
          }),
        },
      }] })
      const { body } = await request.post('/users').set('Content-Type', 'application/json').send('not json at all').expect(400)
      expect(body.error).toBe('Invalid JSON body')
      await close()
    })
  })

  describe('combined schemas', () => {
    it('validates params, query, and body together', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/orgs/:org/members',
        handlers: {
          POST: defineHandler({
            params: okSchema(),
            query: okSchema((v) => ({ limit: parseInt((v as any).limit ?? '10', 10) })),
            body: okSchema(),
            handler: async (req, res) => {
              res.status(200).json({
                org: (req.params as any).org,
                limit: (req.query as any).limit,
                name: (req as any).body.name,
              })
            },
          }),
        },
      }] })
      await request.post('/orgs/acme/members?limit=5').set('Content-Type', 'application/json').send({ name: 'alice' }).expect(200).expect({ org: 'acme', limit: 5, name: 'alice' })
      await close()
    })

    it('short-circuits on params failure and never reads body', async () => {
      const { request, close } = await createTestApp({ routes: [{
        path: '/orgs/:org/members',
        handlers: {
          POST: defineHandler({
            params: failSchema('org not found'),
            body: okSchema(),
            handler: jest.fn(),
          }),
        },
      }] })
      const { body } = await request.post('/orgs/acme/members').set('Content-Type', 'application/json').send({ name: 'alice' }).expect(400)
      expect(body.issues[0].message).toBe('org not found')
      await close()
    })
  })

  describe('backwards compatibility', () => {
    it('plain handlers work alongside defineHandler routes', async () => {
      const { request, close } = await createTestApp({ routes: [
        { path: '/plain', handlers: { GET: async (_req: any, res: any) => { res.status(200).json({ type: 'plain' }) } } },
        {
          path: '/validated/:id',
          handlers: {
            GET: defineHandler({
              params: okSchema(),
              handler: async (req, res) => { res.status(200).json({ type: 'validated', id: (req.params as any).id }) },
            }),
          },
        },
      ] })
      await request.get('/plain').expect(200).expect({ type: 'plain' })
      await request.get('/validated/99').expect(200).expect({ type: 'validated', id: '99' })
      await close()
    })
  })
})
