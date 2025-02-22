import { IncomingMessage, ServerResponse } from "http";

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

export type { Handler, RouteHandlers, Route };
export * from "./sse";
