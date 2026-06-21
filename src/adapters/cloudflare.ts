import type { Adapter, ServerlessConfig, PlatformContext } from '@/types'
import { findRoute, isRouteError, registerRoutes } from '@/core/router'
import {
  runMiddlewares, registerMiddlewareConfig, registerMiddlewares,
  hasMiddlewares, registerHooksConfig, hasNotFoundHook, runNotFoundHook,
} from '@/core/middleware'
import { registerCorsConfig } from '@/core/cors'
import {
  handleAdapterError, parseQueryString, withRequestMethods,
} from '@/utils/adapter-base'
import { WebApiResponse, WebApiRequestBase, buildWebApiResponse } from '@/utils/web-adapter-base'

class _CFRequestBase extends WebApiRequestBase {
  // Cloudflare-specific: all platform context lives under req.platform; the CF
  // scaffold's env.d.ts augments PlatformContext so these are accessible without
  // `as any`. The real client IP comes from the cf-connecting-ip header.
  constructor(req: globalThis.Request, url: { pathname: string; search: string }, env: unknown, ctx: unknown) {
    super(req, url.pathname + url.search, (req.headers as any).get?.('cf-connecting-ip') ?? '')
    this.platform = { env, ctx, cf: (req as any).cf } as PlatformContext
  }
}

class CFRequest extends withRequestMethods(_CFRequestBase) {}

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

    const defaultHeadersEntries = config.defaultHeaders ? Object.entries(config.defaultHeaders) : []

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
        req._maxBodySize = (config as any).maxBodySize
        ;(req as any).query = parseQueryString(url.search)
        const res = new CFResponse()

        try {
          for (let i = 0; i < defaultHeadersEntries.length; i++) {
            res.setHeader(defaultHeadersEntries[i][0], defaultHeadersEntries[i][1])
          }

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
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (route.allowedMethods?.length) headers['Allow'] = route.allowedMethods.join(', ')
            return new globalThis.Response(JSON.stringify({ error: route.error }), {
              status: route.status ?? 500,
              headers,
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
