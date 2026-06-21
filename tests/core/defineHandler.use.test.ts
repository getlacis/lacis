import { IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'
import { applyRequestMethods } from '@/utils/adapter-base'
import { defineHandler } from '@/core/defineHandler'
import type { Request, Response } from '@/types'

function makeReq(): Request {
  const req = new IncomingMessage(new Socket()) as Request
  req.method = 'GET'
  req.url = '/'
  applyRequestMethods(req)
  return req
}

function makeRes() {
  const raw = new ServerResponse(new IncomingMessage(new Socket())) as unknown as Response
  const captured: { status: number; body: unknown; headersSent: boolean } = { status: 200, body: undefined, headersSent: false }
  raw.status = (code) => { captured.status = code; return raw }
  raw.json = (data) => { captured.body = data; captured.headersSent = true; Object.defineProperty(raw, 'headersSent', { value: true, configurable: true }); return raw as any }
  raw.end = (() => raw) as any
  raw.setHeader = (() => raw) as any
  return { res: raw, captured }
}

describe('defineHandler — use: per-route middleware', () => {
  it('runs use middleware in order before the handler', async () => {
    const order: string[] = []
    const handler = defineHandler({
      use: [
        async () => { order.push('mw1') },
        async () => { order.push('mw2') },
      ],
      handler: async () => { order.push('handler') },
    })
    await handler(makeReq(), makeRes().res)
    expect(order).toEqual(['mw1', 'mw2', 'handler'])
  })

  it('stops the chain and skips the handler when a middleware returns false', async () => {
    const order: string[] = []
    const handler = defineHandler({
      use: [
        async () => { order.push('mw1') },
        async () => { order.push('mw2'); return false },
        async () => { order.push('mw3') },
      ],
      handler: async () => { order.push('handler') },
    })
    await handler(makeReq(), makeRes().res)
    expect(order).toEqual(['mw1', 'mw2'])
  })

  it('stops when a middleware sends the response (headersSent)', async () => {
    const handlerSpy = jest.fn()
    const handler = defineHandler({
      use: [
        async (_req: Request, res: Response) => { res.status(403).json({ error: 'forbidden' }) },
      ],
      handler: handlerSpy,
    })
    const { res, captured } = makeRes()
    await handler(makeReq(), res)
    expect(handlerSpy).not.toHaveBeenCalled()
    expect(captured.status).toBe(403)
  })

  it('passes req/res through to each middleware', async () => {
    const seen: unknown[] = []
    const req = makeReq()
    const { res } = makeRes()
    const handler = defineHandler({
      use: [async (r: Request) => { seen.push(r) }],
      handler: async () => {},
    })
    await handler(req, res)
    expect(seen[0]).toBe(req)
  })
})
