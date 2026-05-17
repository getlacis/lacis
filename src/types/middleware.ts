import type { Request, Response } from "./http";

type MiddlewareType = 'beforeRequest' | 'afterRequest' | 'onError';
type MiddlewareCallback = (req: Request, res: Response, context?: any) => Promise<void | boolean> | void | boolean;

type NotFoundHook = (req: Request, res: Response) => void | Promise<void>;
type ShutdownHook = () => void | Promise<void>;

interface MiddlewareModule {
  beforeRequest?: MiddlewareCallback[];
  afterRequest?: MiddlewareCallback[];
  onError?: MiddlewareCallback[];
}

type PathMiddlewares = Map<string, {
  beforeRequest: MiddlewareCallback[];
  afterRequest: MiddlewareCallback[];
  onError: MiddlewareCallback[];
}>;

export type { MiddlewareType, MiddlewareCallback, MiddlewareModule, PathMiddlewares, NotFoundHook, ShutdownHook };