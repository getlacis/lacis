const mockRegisterRoutes = jest.fn()
const mockFindRoute = jest.fn()
const mockIsRouteError = jest.fn().mockReturnValue(false)
const mockRunMiddlewares = jest.fn().mockResolvedValue(true)
const mockRegisterMiddlewareConfig = jest.fn()
const mockRegisterMiddlewares = jest.fn()
const mockRegisterCorsConfig = jest.fn()
const mockRegisterHooksConfig = jest.fn()
const mockHasMiddlewares = jest.fn().mockReturnValue(false)
const mockHasNotFoundHook = jest.fn().mockReturnValue(false)
const mockRunNotFoundHook = jest.fn().mockResolvedValue(undefined)

jest.mock('@/core/router', () => ({
  registerRoutes: (...args: any[]) => mockRegisterRoutes(...args),
  findRoute: (...args: any[]) => mockFindRoute(...args),
  isRouteError: (...args: any[]) => mockIsRouteError(...args),
}))

jest.mock('@/core/middleware', () => ({
  runMiddlewares: (...args: any[]) => mockRunMiddlewares(...args),
  registerMiddlewareConfig: (...args: any[]) => mockRegisterMiddlewareConfig(...args),
  registerMiddlewares: (...args: any[]) => mockRegisterMiddlewares(...args),
  registerHooksConfig: (...args: any[]) => mockRegisterHooksConfig(...args),
  hasMiddlewares: () => mockHasMiddlewares(),
  hasNotFoundHook: () => mockHasNotFoundHook(),
  runNotFoundHook: (...args: any[]) => mockRunNotFoundHook(...args),
}))

jest.mock('@/core/cors', () => ({
  registerCorsConfig: (...args: any[]) => mockRegisterCorsConfig(...args),
}))

import { cloudflareAdapter } from '@/adapters/cloudflare'
import type { Request as LacisRequest, Response as LacisResponse } from '@/types'

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method })
}

const mockEnv = { TEST_VAR: 'test-value' }
const mockCtx = { waitUntil: jest.fn(), passThroughOnException: jest.fn() }

type CFHandler = { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }

function getHandler(): CFHandler {
  return cloudflareAdapter.createHandler({ routes: [] }) as CFHandler
}

const makeRoute = (handler: Function) => ({ handler, params: {} })

async function readStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRunMiddlewares.mockResolvedValue(true)
  mockHasMiddlewares.mockReturnValue(false)
  mockHasNotFoundHook.mockReturnValue(false)
  mockFindRoute.mockReturnValue(null)
  mockIsRouteError.mockReturnValue(false)
})

describe('cloudflareAdapter.createHandler()', () => {
  it('throws when passed a routesDir string', () => {
    expect(() => cloudflareAdapter.createHandler('routes')).toThrow('routesDir')
  })

  it('registers routes on first fetch', async () => {
    const handler = getHandler()
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(mockRegisterRoutes).toHaveBeenCalledWith([])
  })

  it('registers cors, middleware config and hooks on first fetch', async () => {
    const handler = getHandler()
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(mockRegisterCorsConfig).toHaveBeenCalled()
    expect(mockRegisterMiddlewareConfig).toHaveBeenCalled()
    expect(mockRegisterHooksConfig).toHaveBeenCalled()
  })

  it('only calls registerRoutes once across concurrent fetches', async () => {
    const handler = getHandler()
    await Promise.all([
      handler.fetch(makeRequest('/a'), mockEnv, mockCtx),
      handler.fetch(makeRequest('/b'), mockEnv, mockCtx),
    ])
    expect(mockRegisterRoutes).toHaveBeenCalledTimes(1)
  })
})

describe('cloudflareAdapter — routing', () => {
  it('returns 404 when no route matches', async () => {
    const handler = getHandler()
    const res = await handler.fetch(makeRequest('/missing'), mockEnv, mockCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Route not found' })
  })

  it('returns the route error status when the matched route carries an error', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue({ error: 'Method Not Allowed', status: 405 })
    mockIsRouteError.mockReturnValue(true)
    const res = await handler.fetch(makeRequest('/users', 'PATCH'), mockEnv, mockCtx)
    expect(res.status).toBe(405)
    expect(await res.json()).toMatchObject({ error: 'Method Not Allowed' })
  })

  it('calls the route handler and returns its response', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => res.status(201).json({ created: true })),
    )
    const res = await handler.fetch(makeRequest('/users', 'POST'), mockEnv, mockCtx)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: true })
  })

  it('forwards route params to req.params', async () => {
    const handler = getHandler()
    let captured: Record<string, string> | undefined
    mockFindRoute.mockReturnValue({
      handler: async (req: LacisRequest, res: LacisResponse) => { captured = req.params; res.status(200).json({}) },
      params: { id: '42' },
    })
    await handler.fetch(makeRequest('/users/42'), mockEnv, mockCtx)
    expect(captured).toEqual({ id: '42' })
  })

  it('auto-ends the response when the handler returns without calling res.end()', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => { res.statusCode = 204 }),
    )
    const res = await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(res.status).toBe(204)
  })

  it('returns 500 when the route handler throws', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(makeRoute(async () => { throw new Error('boom') }))
    const res = await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(res.status).toBe(500)
  })
})

describe('cloudflareAdapter — env & ctx', () => {
  it('exposes env on req', async () => {
    const handler = getHandler()
    let capturedEnv: unknown
    mockFindRoute.mockReturnValue(
      makeRoute(async (req: LacisRequest, res: LacisResponse) => {
        capturedEnv = (req as any).env
        res.status(200).json({})
      }),
    )
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(capturedEnv).toBe(mockEnv)
  })

  it('exposes ctx on req', async () => {
    const handler = getHandler()
    let capturedCtx: unknown
    mockFindRoute.mockReturnValue(
      makeRoute(async (req: LacisRequest, res: LacisResponse) => {
        capturedCtx = (req as any).ctx
        res.status(200).json({})
      }),
    )
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(capturedCtx).toBe(mockCtx)
  })
})

describe('cloudflareAdapter — middleware', () => {
  beforeEach(() => mockHasMiddlewares.mockReturnValue(true))

  it('stops the request and skips the handler when beforeRequest returns false', async () => {
    const handler = getHandler()
    const routeHandler = jest.fn()
    mockFindRoute.mockReturnValue(makeRoute(routeHandler))
    mockRunMiddlewares.mockImplementation(async (type: string, _req: LacisRequest, res: LacisResponse) => {
      if (type === 'beforeRequest') { res.status(403).json({ error: 'forbidden' }); return false }
      return true
    })
    const res = await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(routeHandler).not.toHaveBeenCalled()
    expect(res.status).toBe(403)
  })

  it('calls afterRequest after the handler', async () => {
    const handler = getHandler()
    const order: string[] = []
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => { order.push('handler'); res.status(200).json({}) }),
    )
    mockRunMiddlewares.mockImplementation(async (type: string) => { order.push(type); return true })
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('afterRequest'))
  })

  it('calls onNotFound hook when no route is found', async () => {
    mockHasNotFoundHook.mockReturnValue(true)
    const handler = getHandler()
    await handler.fetch(makeRequest('/missing'), mockEnv, mockCtx)
    expect(mockRunNotFoundHook).toHaveBeenCalled()
  })

  it('calls onError middleware when the route carries an error', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue({ error: 'forbidden', status: 403 })
    mockIsRouteError.mockReturnValue(true)
    await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(mockRunMiddlewares).toHaveBeenCalledWith('onError', expect.anything(), expect.anything())
  })

  it('does not send 500 fallback if onError already responded', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(makeRoute(async () => { throw new Error('boom') }))
    mockRunMiddlewares.mockImplementation(async (type: string, _req: LacisRequest, res: LacisResponse) => {
      if (type === 'onError') res.status(503).json({ error: 'custom' })
      return true
    })
    const res = await handler.fetch(makeRequest('/'), mockEnv, mockCtx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'custom' })
  })
})

describe('cloudflareAdapter — SSE', () => {
  it('returns a streaming response when initSSE is called synchronously', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => {
        const sse = res.initSSE({ timeout: 60000 })
        sse.send('hello')
        sse.close()
      }),
    )
    const res = await handler.fetch(makeRequest('/sse'), mockEnv, mockCtx)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await readStream(res.body!)
    expect(text).toContain('data: hello')
  })

  it('streams multiple events in order', async () => {
    const handler = getHandler()
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => {
        const sse = res.initSSE({ timeout: 60000 })
        sse.event('tick', { n: 1 })
        sse.event('tick', { n: 2 })
        sse.close()
      }),
    )
    const res = await handler.fetch(makeRequest('/sse'), mockEnv, mockCtx)
    const text = await readStream(res.body!)
    expect(text.indexOf('"n":1')).toBeLessThan(text.indexOf('"n":2'))
  })

  it('throws if initSSE is called after the detection window closes', async () => {
    const handler = getHandler()
    let caughtError: unknown = null
    mockFindRoute.mockReturnValue({
      handler: (_req: LacisRequest, res: LacisResponse) =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            try { res.initSSE() } catch (e) { caughtError = e }
            res.end()
            resolve()
          }, 0)
        }),
      params: {},
    })
    await handler.fetch(makeRequest('/sse'), mockEnv, mockCtx)
    expect((caughtError as Error)?.message).toContain('[lacis/cloudflare]')
  })
})
