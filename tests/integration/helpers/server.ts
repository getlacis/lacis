import http from 'http';
import { IncomingMessage } from 'http';
import supertest from 'supertest';
import { findRoute, registerRoutes, resetRouter } from '@/core/router';
import { hasMiddlewares, registerMiddlewareConfig, resetMiddlewares, runMiddlewares } from '@/core/middleware';
import { registerCorsConfig } from '@/core/cors';
import { nodeBody, withRequestMethods, withResponseMethods } from '@/utils/adapter-base';
import type { CorsConfig, ServerlessRoute } from '@/types';
import type { MiddlewareCallback } from '@/types/middleware';

class _ReqBase extends IncomingMessage {
  params: Record<string, string> = {};
  body = nodeBody;
}
class TestRequest extends withRequestMethods(_ReqBase) {}
class TestResponse extends withResponseMethods(http.ServerResponse<TestRequest>) {}

export interface TestServerOptions {
  routes?: ServerlessRoute[];
  cors?: CorsConfig;
  middleware?: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
}

export function createTestApp(options: TestServerOptions = {}) {
  resetRouter();
  resetMiddlewares();

  if (options.routes) registerRoutes(options.routes);
  if (options.cors) registerCorsConfig(options.cors);
  if (options.middleware) registerMiddlewareConfig(options.middleware);

  const server = http.createServer<typeof TestRequest, typeof TestResponse>(
    { IncomingMessage: TestRequest, ServerResponse: TestResponse },
    async (req, res) => {
      try {
        const rawUrl = req.url ?? '/';
        const pathname = rawUrl.includes('?') ? rawUrl.slice(0, rawUrl.indexOf('?')) : rawUrl;

        if (hasMiddlewares()) {
          const ok = await runMiddlewares('beforeRequest', req as any, res as any);
          if (ok === false || res.headersSent) return;
        }

        const route = findRoute(pathname, req.method ?? 'GET');

        if (!route) {
          res.status(404).json({ error: 'Route not found' });
          return;
        }

        if ('error' in route) {
          res.status((route as any).status ?? 500).json({ error: (route as any).error });
          return;
        }

        req.params = route.params;
        await route.handler(req as any, res as any);

        if (hasMiddlewares()) await runMiddlewares('afterRequest', req as any, res as any);
        if (!res.headersSent) res.end();
      } catch {
        if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
      }
    },
  );

  return supertest(server);
}
