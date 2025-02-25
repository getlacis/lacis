import { IncomingMessage, ServerResponse } from "http";
import type { MiddlewareCallback } from "./middleware";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// Handler for each HTTP method, need to be modified to give extra parameters and functionality
type GetHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type PostHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type PutHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type DeleteHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;
type PatchHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

type RouteHandlers = {
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  DELETE?: Handler;
  PATCH?: Handler;
};

type Route = {
  pattern: RegExp;
  handlers: RouteHandlers;
  params: string[];
};

interface ServerConfig {
  isDev?: boolean;
  port?: number;
  platform?: 'node' | 'vercel' | 'netlify';
  httpsOptions?: {
    cert?: string | Buffer;
    key?: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  },
  defaultHeaders?: Record<string, string>;
  globalMiddlewares?: {
    beforeRequest?: MiddlewareCallback;
    afterRequest?: MiddlewareCallback;
    onError?: MiddlewareCallback;
  };
}

export type { Handler, RouteHandlers, Route, ServerConfig };
export * from "./sse";
export * from "./adapter";
export * from "./platform";
export * from "./enhancer";
export * from "./platform";
export * from "./middleware";
