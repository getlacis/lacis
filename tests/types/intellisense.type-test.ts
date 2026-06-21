// Type-level verification of the developer-facing IntelliSense.
// Not a jest test (no .test.ts): tsc type-checks it via tsconfig.test.json.
// `@ts-expect-error` lines FAIL the typecheck if the expected error does NOT occur,
// so a clean `tsc` proves both the positive inference and the negative cases.
import { defineHandler } from '@/core/defineHandler'
import type { Request, Response } from '@/types'

// Augment the per-request context like a real app would.
declare module '@/types' {
  interface Locals {
    user: { id: string; role: 'admin' | 'user' }
  }
  interface PlatformContext {
    env: { MY_KV: { get(k: string): Promise<string | null> } }
  }
}

// A typed schema with concrete output, mimicking a real validator.
function s<T>() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (v: unknown) => ({ value: v as T }),
      types: { input: undefined as any as T, output: undefined as any as T },
    },
  }
}

// 1) params / query / body inference
defineHandler({
  params: s<{ id: string }>(),
  query: s<{ page: number }>(),
  body: s<{ name: string }>(),
  handler: async (req, res) => {
    const id: string = req.params.id        // inferred string
    const page: number = req.query.page     // inferred number
    const name: string = req.body.name      // inferred string
    void id; void page; void name
    // @ts-expect-error params.id is string, not number
    const bad: number = req.params.id
    void bad
    res.json({ ok: true })
  },
})

// 2) typed responses
defineHandler({
  responses: { 200: s<{ ok: boolean }>(), 404: s<{ error: string }>() },
  handler: async (_req, res) => {
    res.status(200).json({ ok: true })
    res.status(404).json({ error: 'nope' })
    // @ts-expect-error 200 expects { ok: boolean }
    res.status(200).json({ error: 'x' })
    res.raw.json({ anything: true }) // escape hatch is untyped
  },
})

// 3) req.locals (augmented) is typed in handlers and middleware
const authMw = async (req: Request, _res: Response) => {
  req.locals.user = { id: 'u1', role: 'admin' }
  // @ts-expect-error role is 'admin' | 'user'
  req.locals.user.role = 'superadmin'
}

defineHandler({
  use: [authMw],
  handler: async (req, res) => {
    const role: 'admin' | 'user' = req.locals.user.role // typed via augmentation
    void role
    res.json({ id: req.locals.user.id })
  },
})

// 4) req.platform (augmented) is typed
defineHandler({
  handler: async (req, res) => {
    const v = await req.platform.env.MY_KV.get('k') // typed binding access
    void v
    // @ts-expect-error MISSING is not a declared binding
    req.platform.env.MISSING
    res.json({ ok: true })
  },
})

// 5) without `responses`, res stays the plain (loose) Response
defineHandler({
  handler: async (_req, res) => {
    res.status(200).json({ literally: 'anything', is: 'fine' })
  },
})
