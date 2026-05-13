import type { IncomingMessage, ServerResponse } from "http";
import type { Route, SSEClient, SSEClientOptions, SSEEventHandlers, Request, Response, RouteHandlers } from ".";
import type { MiddlewareCallback } from "./middleware";

interface AdapterRequest extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
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
  middleware?: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
}

interface Adapter {
  name: string;
  createHandler: (config: string | ServerlessConfig) => unknown;
  transformRequest?: (req: any) => Request;
  transformResponse?: (res: any) => Response;
}

export type {
  Adapter,
  AdapterContext,
  AdapterRequest,
  AdapterResponse,
  ServerlessRoute,
  ServerlessConfig,
};
