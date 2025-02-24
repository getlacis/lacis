import type { IncomingMessage, ServerResponse } from "http";
import type { Route, SSEClient, SSEClientOptions, SSEEventHandlers, Request, Response } from ".";

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

interface Adapter {
  name: string;
  createHandler: (routesDir: string) => unknown;
  transformRequest?: (req: any) => Request;
  transformResponse?: (res: any) => Response;
}

export type {
  Adapter,
  AdapterContext,
  AdapterRequest,
  AdapterResponse,
};
