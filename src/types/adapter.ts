import type { IncomingMessage, Server, ServerResponse } from "http";
import type { NetlifyContext, NetlifyEvent, Route, ServerConfig } from ".";

interface AdapterRequest extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
}

interface AdapterResponse extends ServerResponse {
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
  transformRequest?: (req: any) => AdapterRequest;
  transformResponse?: (res: any) => AdapterResponse;
}

export type {
  Adapter,
  AdapterContext,
  AdapterRequest,
  AdapterResponse,
};
