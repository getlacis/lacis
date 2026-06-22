// Verifies: a `use:` middleware that RETURNS an object gets its type inferred into
// req.locals for the handler — with no annotations and no declare-module augmentation.
import { defineHandler } from '@/core/defineHandler'
import type { Request, Response } from '@/types'

// Plain middleware, zero annotations: the return value is inferred.
const auth = (req: Request) => {
  return { user: { id: '1', role: 'admin' as const } }
}

// Middleware that may stop (returns false) or contribute — union return type.
const maybeSession = (req: Request, _res: Response) => {
  if (!req.getHeader('cookie')) return false
  return { session: { token: 'abc' } }
}

// A pure guard that contributes nothing (returns void / boolean).
const rateLimit = (_req: Request, _res: Response) => {
  return true
}

defineHandler({
  use: [auth, maybeSession, rateLimit],
  handler: async (req, res) => {
    // inferred from auth's return — no augmentation needed
    const id: string = req.locals.user.id
    const role: 'admin' = req.locals.user.role
    // inferred from maybeSession's object branch (false is stripped)
    const token: string = req.locals.session.token
    void id; void role; void token

    // @ts-expect-error user.id is string, not number
    const bad: number = req.locals.user.id
    void bad
    // @ts-expect-error rateLimit contributed nothing — `nope` is not on locals
    req.locals.nope

    res.json({ ok: true })
  },
})

// No use: → locals is just the (global) Locals, no inferred members.
defineHandler({
  handler: async (req, res) => {
    // @ts-expect-error nothing was contributed
    req.locals.user
    res.json({ ok: true })
  },
})
