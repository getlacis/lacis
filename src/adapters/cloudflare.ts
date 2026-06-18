import type { Adapter, ServerlessConfig } from '@/types'
import { findRoute, isRouteError, registerRoutes } from '@/core/router'
import {
  runMiddlewares, registerMiddlewareConfig, registerMiddlewares,
  hasMiddlewares, registerHooksConfig, hasNotFoundHook, runNotFoundHook,
} from '@/core/middleware'
import { registerCorsConfig } from '@/core/cors'
import {
  handleAdapterError, parseQueryString, withRequestMethods, type LacisHeaders,
} from '@/utils/adapter-base'
import { WebApiResponse, buildWebApiResponse, WEB_MAX_BODY_SIZE } from '@/utils/web-adapter-base'

class _CFRequestBase {
  params: Record<string, string> = {}
  url: string
  method: string
  headers: LacisHeaders
  env: unknown
  ctx: unknown
  socket = { setTimeout: (_: number) => {} } as const
  connection: { remoteAddress: string }
  private _req: globalThis.Request

  constructor(req: globalThis.Request, url: { pathname: string; search: string }, env: unknown, ctx: unknown) {
    this._req = req
    this.url = url.pathname + url.search
    this.method = req.method
    this.headers = req.headers as unknown as LacisHeaders
    this.env = env
    this.ctx = ctx
    this.connection = { remoteAddress: '' }
  }

  setTimeout(_: number) {}

  body() {
    return this._req.arrayBuffer().then((b: ArrayBuffer) => {
      if (b.byteLength > WEB_MAX_BODY_SIZE)
        throw Object.assign(new Error('Payload Too Large'), { code: 413 })
      return Buffer.from(b)
    })
  }
}

class CFRequest extends withRequestMethods(_CFRequestBase) {
  json<T = any>(): Promise<T> {
    return (this as any)._req.json() as Promise<T>
  }
}

class CFResponse extends WebApiResponse {
  protected _adapterName = 'cloudflare'
}

export const cloudflareAdapter: Adapter = {
  name: 'cloudflare',
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config === 'string') {
      throw new Error(
        'cloudflareAdapter.createHandler() requires a ServerlessConfig object, not a routesDir string. ' +
        'Import your routes manifest and pass { routes } instead.',
      )
    }

    let initPromise: Promise<void> | null = null

    const init = (): Promise<void> => {
      if (initPromise) return initPromise
      initPromise = (async () => {
        registerRoutes(config.routes)
        registerCorsConfig(config.cors)
        registerMiddlewareConfig(config.middleware)
        registerMiddlewares(config.middlewares ?? [])
        registerHooksConfig(config.hooks)
      })()
      return initPromise
    }

    return {
      async fetch(request: globalThis.Request, env: unknown, ctx: unknown): Promise<globalThis.Response> {
        await init()

        const url = new URL(request.url)
        const req = new CFRequest(request, url, env, ctx)
        ;(req as any).query = parseQueryString(url.search)
        const res = new CFResponse()

        try {
          if (hasMiddlewares()) {
            const ok = await runMiddlewares('beforeRequest', req as any, res as any)
            if (!ok || res.headersSent) return buildWebApiResponse(res)
          }

          const route = findRoute(url.pathname, request.method)

          if (!route) {
            if (hasNotFoundHook()) {
              await runNotFoundHook(req as any, res as any)
              if (res.headersSent) return buildWebApiResponse(res)
            }
            return new globalThis.Response(JSON.stringify({ error: 'Route not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (isRouteError(route)) {
            if (hasMiddlewares()) await runMiddlewares('onError', req as any, res as any)
            return new globalThis.Response(JSON.stringify({ error: route.error }), {
              status: route.status ?? 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          req.params = route.params

          let handlerError: unknown = null
          const handlerDone = (async () => {
            await route.handler(req as any, res as any)
            if (hasMiddlewares()) await runMiddlewares('afterRequest', req as any, res as any)
            if (!res.headersSent) res.end()
          })().catch((err) => {
            handlerError = err
          })

          // Handler's sync portion has run up to its first await — SSE window closes now
          res._closeSseWindow()

          if (res._sseReadable) {
            return buildWebApiResponse(res, res._sseReadable)
          }

          await handlerDone

          if (handlerError) {
            await handleAdapterError(req as any, res as any, handlerError)
            if (!res.headersSent) {
              return new globalThis.Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              })
            }
          }

          return buildWebApiResponse(res)
        } catch (error) {
          await handleAdapterError(req as any, res as any, error)
          if (!res.headersSent) {
            return new globalThis.Response(JSON.stringify({ error: 'Internal Server Error' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          return buildWebApiResponse(res)
        }
      },
    }
  },
}
