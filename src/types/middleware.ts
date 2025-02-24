import type { Request, Response } from "./enhancer";

type MiddlewareType = 'beforeRequest' | 'afterRequest' | 'onError';
type MiddlewareCallback = (req: Request, res: Response, context?: any) => Promise<void | boolean> | void | boolean;

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

export type { MiddlewareType, MiddlewareCallback, MiddlewareModule, PathMiddlewares };