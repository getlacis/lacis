import { IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'
import { applyRequestMethods } from '@/utils/adapter-base'
import { defineHandler } from '@/core/defineHandler'
import { okSchema, failSchema, asyncOkSchema } from '../helpers/schemas'
import type { Request, Response } from '@/types'

function makeReq(opts: {
  params?: Record<string, string>
  query?: Record<string, string>
  jsonBody?: unknown
  jsonThrows?: boolean
} = {}): Request {
  const req = new IncomingMessage(new Socket()) as Request
  req.method = 'GET'
  req.url = '/'
  applyRequestMethods(req)
  if (opts.params) req.params = opts.params
  if (opts.query) (req as any).query = opts.query
  if (opts.jsonThrows) {
    req.json = () => Promise.reject(new SyntaxError('Unexpected token'))
  } else if (opts.jsonBody !== undefined) {
    req.json = () => Promise.resolve(opts.jsonBody as any)
  }
  return req
}

function makeRes() {
  const raw = new ServerResponse(new IncomingMessage(new Socket())) as unknown as Response
  const captured: { status: number; body: unknown } = { status: 200, body: undefined }
  raw.status = (code) => { captured.status = code; return raw }
  raw.json = (data) => { captured.body = data }
  raw.end = (() => raw) as any
  raw.setHeader = (() => raw) as any
  return { res: raw, captured }
}


describe('defineHandler', () => {
  describe('no schema', () => {
    it('calls handler directly', async () => {
      const called = jest.fn()
      const handler = defineHandler({ handler: called })
      const req = makeReq()
      const { res } = makeRes()
      await handler(req, res)
      expect(called).toHaveBeenCalledWith(req, res)
    })
  })

  describe('params', () => {
    it('passes validated params to handler', async () => {
      let received: unknown
      const handler = defineHandler({
        params: okSchema((v) => ({ ...(v as object), id: 'parsed' })),
        handler: async (req) => { received = req.params },
      })
      const req = makeReq({ params: { id: 'raw' } })
      const { res } = makeRes()
      await handler(req, res)
      expect(received).toEqual({ id: 'parsed' })
    })

    it('returns 400 and skips handler on params failure', async () => {
      const called = jest.fn()
      const handler = defineHandler({
        params: failSchema('id is required'),
        handler: called,
      })
      const req = makeReq({ params: {} })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(called).not.toHaveBeenCalled()
      expect(captured.status).toBe(400)
      expect((captured.body as any).error).toBe('Validation failed')
      expect((captured.body as any).issues[0].message).toBe('id is required')
    })

    it('falls back to empty object when req.params is undefined', async () => {
      let received: unknown
      const handler = defineHandler({
        params: okSchema(),
        handler: async (req) => { received = req.params },
      })
      const req = makeReq()
      const { res } = makeRes()
      await handler(req, res)
      expect(received).toEqual({})
    })
  })

  describe('query', () => {
    it('passes validated query to handler', async () => {
      let received: unknown
      const handler = defineHandler({
        query: okSchema((v) => ({ ...(v as object), page: 2 })),
        handler: async (req) => { received = req.query },
      })
      const req = makeReq({ query: { page: '2' } })
      const { res } = makeRes()
      await handler(req, res)
      expect(received).toEqual({ page: 2 })
    })

    it('returns 400 and skips handler on query failure', async () => {
      const called = jest.fn()
      const handler = defineHandler({
        query: failSchema('page must be a number'),
        handler: called,
      })
      const req = makeReq({ query: { page: 'abc' } })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(called).not.toHaveBeenCalled()
      expect(captured.status).toBe(400)
      expect((captured.body as any).issues[0].message).toBe('page must be a number')
    })
  })

  describe('body', () => {
    it('passes validated body to handler', async () => {
      let received: unknown
      const handler = defineHandler({
        body: okSchema(),
        handler: async (req) => { received = (req as any).body },
      })
      const req = makeReq({ jsonBody: { name: 'zeno' } })
      const { res } = makeRes()
      await handler(req, res)
      expect(received).toEqual({ name: 'zeno' })
    })

    it('returns 400 and skips handler on body schema failure', async () => {
      const called = jest.fn()
      const handler = defineHandler({
        body: failSchema('name is required'),
        handler: called,
      })
      const req = makeReq({ jsonBody: {} })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(called).not.toHaveBeenCalled()
      expect(captured.status).toBe(400)
      expect((captured.body as any).issues[0].message).toBe('name is required')
    })

    it('returns 400 when JSON parsing throws', async () => {
      const called = jest.fn()
      const handler = defineHandler({
        body: okSchema(),
        handler: called,
      })
      const req = makeReq({ jsonThrows: true })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(called).not.toHaveBeenCalled()
      expect(captured.status).toBe(400)
      expect((captured.body as any).error).toBe('Invalid JSON body')
    })
  })

  describe('combined schemas', () => {
    it('validates params, query, and body in order', async () => {
      const calls: string[] = []
      const paramsSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: (v: unknown) => { calls.push('params'); return { value: v } },
          types: undefined as any,
        },
      }
      const querySchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: (v: unknown) => { calls.push('query'); return { value: v } },
          types: undefined as any,
        },
      }
      const bodySchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: (v: unknown) => { calls.push('body'); return { value: v } },
          types: undefined as any,
        },
      }
      const handler = defineHandler({
        params: paramsSchema,
        query: querySchema,
        body: bodySchema,
        handler: async () => { calls.push('handler') },
      })
      const req = makeReq({ params: { id: '1' }, query: { page: '1' }, jsonBody: {} })
      const { res } = makeRes()
      await handler(req, res)
      expect(calls).toEqual(['params', 'query', 'body', 'handler'])
    })

    it('stops at first failure and does not call subsequent validations', async () => {
      const queryCalled = jest.fn()
      const handler = defineHandler({
        params: failSchema('bad params'),
        query: {
          '~standard': {
            version: 1 as const,
            vendor: 'test',
            validate: (v: unknown) => { queryCalled(); return { value: v } },
            types: undefined as any,
          },
        },
        handler: jest.fn(),
      })
      const req = makeReq({ params: {}, query: {} })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(queryCalled).not.toHaveBeenCalled()
      expect(captured.status).toBe(400)
    })
  })

  describe('async schema', () => {
    it('supports schemas with async validate', async () => {
      let received: unknown
      const handler = defineHandler({
        params: asyncOkSchema(),
        handler: async (req) => { received = req.params },
      })
      const req = makeReq({ params: { id: '42' } })
      const { res } = makeRes()
      await handler(req, res)
      expect(received).toEqual({ id: '42' })
    })
  })

  describe('issue path formatting', () => {
    it('normalizes path segments with a key property', async () => {
      const handler = defineHandler({
        params: {
          '~standard': {
            version: 1 as const,
            vendor: 'test',
            validate: (_: unknown) => ({
              issues: [{ message: 'invalid', path: [{ key: 'id' }] }],
            }),
            types: undefined as any,
          },
        },
        handler: jest.fn(),
      })
      const req = makeReq({ params: {} })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect((captured.body as any).issues[0].path).toEqual(['id'])
    })

    it('keeps plain PropertyKey path segments as-is', async () => {
      const handler = defineHandler({
        params: {
          '~standard': {
            version: 1 as const,
            vendor: 'test',
            validate: (_: unknown) => ({
              issues: [{ message: 'invalid', path: ['name', 0] }],
            }),
            types: undefined as any,
          },
        },
        handler: jest.fn(),
      })
      const req = makeReq({ params: {} })
      const { res, captured } = makeRes()
      await handler(req, res)
      expect((captured.body as any).issues[0].path).toEqual(['name', 0])
    })
  })

  describe('_defineHandler metadata', () => {
    it('attaches config to the returned function', () => {
      const config = {
        params: okSchema(),
        meta: { summary: 'Get user', tags: ['users'] },
        handler: jest.fn(),
      }
      const handler = defineHandler(config)
      expect((handler as any)._defineHandler).toBe(config)
    })
  })
})
