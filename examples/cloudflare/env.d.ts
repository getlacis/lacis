// Cloudflare scaffold: augments lacis so `req.platform` is typed with the Worker
// bindings, ExecutionContext and incoming request properties. This is the file a
// `create-lacis` Cloudflare template generates. With it, handlers access
// `req.platform.env`, `req.platform.ctx` and `req.platform.cf` without `as any`.
import type {} from '@cloudflare/workers-types'

declare global {
  // Add your KV/D1/R2/secret bindings here, e.g.:
  //   interface Env { MY_KV: KVNamespace; DB: D1Database }
  interface Env {}
}

declare module 'lacis' {
  interface PlatformContext {
    env: Env
    ctx: ExecutionContext
    cf: IncomingRequestCfProperties
  }
}

export {}
