import type { MiddlewareCallback } from "./middleware";
import type { Request, Response } from "./http";
import type { ServerlessRoute } from "./adapter";

interface CorsConfig {
  origin?: string | string[] | RegExp | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

type Handler = (req: Request, res: Response) => Promise<void>;

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

// Dans src/types/index.ts
interface ServerConfig {
  // Options existantes
  isDev?: boolean;
  port?: number;
  platform?: 'node' | 'vercel' | 'netlify' | 'bun';
  timeout?: number;
  httpsOptions?: {
    cert?: string | Buffer;
    key?: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  },
  cluster?: {
    enabled: boolean;
    workers?: number;
  };
  defaultHeaders?: Record<string, string>;
  cors?: CorsConfig;
  middleware?: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
  
  routes?: ServerlessRoute[];

  openapi?: {
    path?: string
    info: {
      title: string
      version: string
      description?: string
    }
  };

  monitoring?: {
    enabled: boolean;
    sampleInterval?: number;
    reportInterval?: number;
    thresholds?: {
      cpu?: number;
      memory?: number;
      responseTime?: number;
      errorRate?: number;
    };
  };
}

interface ClusterConfig {
  enabled: boolean;
  workers?: number; // Number of workers, defaults to CPU cores
}

export type { Handler, RouteHandlers, Route, ServerConfig, ClusterConfig, CorsConfig };
export * from "./sse";
export * from "./adapter";
export * from "./platform";
export * from "./http";
export * from "./middleware";
export * from "./monitor";
export * from "./loadBalancer";