import { IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'
import { applyRequestMethods } from '@/utils/adapter-base'
import { defineHandler } from '@/core/defineHandler'
import { okSchema, failSchema } from '../helpers/schemas'
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
  const captured: { status: number; body: unknown } = { status: 200, body: undefined }
  raw.status = (code) => { raw.statusCode = code; captured.status = code; return raw }
  raw.json = (data) => { captured.body = data }
  raw.end = (() => raw) as any
  raw.setHeader = (() => raw) as any
  return { res: raw, captured }
}

// Schema with concrete type-level output, for compile-time assertions
function typedSchema<T>() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => ({ value: value as T }),
      types: { input: undefined as any as T, output: undefined as any as T },
    },
  }
}

describe('defineHandler — typed responses', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV
  })

  it('exposes res.raw escape hatch when responses are declared', async () => {
    const handler = defineHandler({
      responses: { 200: okSchema() },
      handler: (_req, res) => { (res as any).raw.json({ anything: true }) },
    })
    const req = makeReq()
    const { res } = makeRes()
    await handler(req, res)
    expect((res as any).raw).toBe(res)
  })

  describe('dev runtime validation', () => {
    beforeEach(() => { process.env.NODE_ENV = 'development' })

    it('rejects a body that does not match the declared schema for the status', async () => {
      const handler = defineHandler({
        responses: { 404: failSchema('bad shape') as any },
        handler: (_req, res) => { res.status(404).json({ id: 1 } as any) },
      })
      const req = makeReq()
      const { res } = makeRes()
      await expect(handler(req, res)).rejects.toThrow('does not match its declared schema')
    })

    it('accepts a body that matches the declared schema', async () => {
      const handler = defineHandler({
        responses: { 200: okSchema() },
        handler: (_req, res) => { res.status(200).json({ ok: true } as any) },
      })
      const req = makeReq()
      const { res, captured } = makeRes()
      await handler(req, res)
      expect(captured.body).toEqual({ ok: true })
    })
  })

  describe('production: no validation', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production' })

    it('does not validate the response body in production', async () => {
      const handler = defineHandler({
        responses: { 404: failSchema('bad shape') as any },
        handler: (_req, res) => { res.status(404).json({ id: 1 } as any) },
      })
      const req = makeReq()
      const { res, captured } = makeRes()
      await expect(handler(req, res)).resolves.toBeUndefined()
      expect(captured.body).toEqual({ id: 1 })
    })

    it('validateResponses:true forces validation in production', async () => {
      const handler = defineHandler({
        responses: { 404: failSchema('bad shape') as any },
        validateResponses: true,
        handler: (_req, res) => { res.status(404).json({ id: 1 } as any) },
      })
      const req = makeReq()
      const { res } = makeRes()
      await expect(handler(req, res)).rejects.toThrow('does not match its declared schema')
    })
  })

  describe('validateResponses:false disables validation in dev', () => {
    beforeEach(() => { process.env.NODE_ENV = 'development' })

    it('skips validation when explicitly disabled', async () => {
      const handler = defineHandler({
        responses: { 404: failSchema('bad shape') as any },
        validateResponses: false,
        handler: (_req, res) => { res.status(404).json({ id: 1 } as any) },
      })
      const req = makeReq()
      const { res, captured } = makeRes()
      await expect(handler(req, res)).resolves.toBeUndefined()
      expect(captured.body).toEqual({ id: 1 })
    })
  })
})

// Compile-time assertions (never executed; verified by ts-jest type-checking).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeChecks() {
  defineHandler({
    responses: {
      200: typedSchema<{ ok: boolean }>(),
      404: typedSchema<{ error: string }>(),
    },
    handler: (_req, res) => {
      res.status(200).json({ ok: true })
      res.status(404).json({ error: 'nope' })
      // @ts-expect-error — 200 expects { ok: boolean }, not { error: string }
      res.status(200).json({ error: 'x' })
      // @ts-expect-error — 404 expects { error: string }, not { id: number }
      res.status(404).json({ id: 1 })
      // raw escape hatch is untyped
      res.raw.json({ whatever: true })
    },
  })
}
