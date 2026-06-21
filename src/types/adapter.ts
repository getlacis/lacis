import type { IncomingMessage, ServerResponse } from "http";
import type { Route, SSEClient, SSEClientOptions, SSEEventHandlers, RouteHandlers, CorsConfig } from ".";
import type { MiddlewareCallback, NotFoundHook, ShutdownHook } from "./middleware";

interface ServerlessMiddleware {
  path: string;
  type: 'cascade' | 'exact';
  module: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
}

interface AdapterRequest extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?(): Promise<Buffer>;
  createSSEClient(
    options?: SSEClientOptions,
    handlers?: SSEEventHandlers
  ): SSEClient;
}

interface AdapterResponse {
  json?: (data: any) => void;
}

interface AdapterContext {
  req: AdapterRequest;
  res: AdapterResponse;
  route?: Route;
}

interface ServerlessRoute {
  path: string;
  handlers: RouteHandlers;
}

interface ServerlessConfig {
  routes: ServerlessRoute[];
  maxBodySize?: number;
  defaultHeaders?: Record<string, string>;
  cors?: CorsConfig;
  middleware?: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
  middlewares?: ServerlessMiddleware[];
  hooks?: {
    onNotFound?: NotFoundHook;
    onShutdown?: ShutdownHook;
  };
}

interface Adapter {
  name: string;
  createHandler: (config: string | ServerlessConfig) => unknown;
}

export type {
  Adapter,
  AdapterContext,
  AdapterRequest,
  AdapterResponse,
  ServerlessRoute,
  ServerlessConfig,
  ServerlessMiddleware,
};
