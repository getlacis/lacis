import supertest, { type Agent } from 'supertest';
import { createServer } from '@/core/server';
import type { CorsConfig, ServerConfig, ServerlessRoute } from '@/types';
import type { MiddlewareCallback } from '@/types/middleware';
import type { Server } from 'http';

export interface TestServerOptions {
  routes?: ServerlessRoute[];
  cors?: CorsConfig;
  middleware?: {
    beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
    afterRequest?: MiddlewareCallback | MiddlewareCallback[];
    onError?: MiddlewareCallback | MiddlewareCallback[];
  };
  openapi?: ServerConfig['openapi'];
}

export interface TestApp {
  request: Agent;
  close: () => Promise<void>;
}

export async function createTestApp(options: TestServerOptions = {}): Promise<TestApp> {
  const server = await createServer('', {
    platform: 'node',
    port: 0,
    cluster: { enabled: false },
    routes: options.routes ?? [],
    cors: options.cors,
    middleware: options.middleware,
    openapi: options.openapi,
  }) as Server;

  const { port } = server.address() as { port: number };

  return {
    request: supertest.agent(`http://localhost:${port}`),
    close: () => new Promise<void>((resolve, reject) =>
      server.close(err => err ? reject(err) : resolve())
    ),
  };
}
