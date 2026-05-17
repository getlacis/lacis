import { getAdapter } from '@/adapters';
import { defaultConfig, type ServerConfig } from "@/config/serverConfig";
import { loadRoutes, registerRoutes, resetRouter, router } from './router';
import { resetMiddlewares, runShutdownHook } from './middleware';
import { buildOpenApiDoc } from './openapi';
import type { Request, Response } from '@/types';
import type { Server } from 'http';
import { primaryLog } from '@/utils/logs';
import cluster from 'cluster';

let serverInstance: Server | null = null;
let isShuttingDown = false;
let shutdownListenersRegistered = false;

async function createServer(
  routesDir: string,
  config: ServerConfig = defaultConfig
) {
  const { platform = 'node' } = config;
  const verbose = config.isDev && cluster.isPrimary && !process.env.LACIS_BUN_WORKER;
  
  try {
    if (config.routes) {
      resetRouter();
      resetMiddlewares();
      registerRoutes(config.routes);
    } else {
      await loadRoutes(routesDir);
    }

    // Build the doc before the adapter runs (needs routes loaded), but register
    // the route after — node/bun adapters call loadRoutes internally which resets the router
    let openapiDoc: object | null = null;
    let openapiPath: string | null = null;
    if (config.openapi) {
      openapiDoc = await buildOpenApiDoc(config.openapi);
      openapiPath = config.openapi.path ?? "/openapi.json";
    }

    if (verbose) {
      primaryLog(`📂 Routes loaded from: ${routesDir}`);
    }

    const adapter = getAdapter(platform);
    const handler = adapter.createHandler(routesDir);

    let server;
    switch (platform) {
      case 'node':
        server = await (handler as (config?: ServerConfig) => Promise<Server>)(config);
        serverInstance = server;
        break;
      case 'bun':
        server = (handler as (config?: ServerConfig) => void)(config);
        break;
      case 'vercel':
      case 'netlify':
        server = handler;
        break;
      default:
        throw new Error(`Unsupported platform: "${platform}"`);
    }

    if (openapiDoc && openapiPath) {
      router.addRoute("GET", openapiPath, (_req: Request, res: Response) => res.json(openapiDoc!));
      if (verbose) primaryLog(`OpenAPI doc available at ${openapiPath}`);
    }

    setupGracefulShutdown();

    return server;
  } catch (error) {
    if (verbose) {
      primaryLog("❌ Failed to create server:", error);
    }
    throw error;
  }
}

function setupGracefulShutdown() {
  if (!cluster.isPrimary) return;
  if (shutdownListenersRegistered) return;
  shutdownListenersRegistered = true;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    primaryLog(`\n${signal} received, shutting down...`);

    await runShutdownHook();

    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise<void>((resolve) => {
        serverInstance!.close(() => resolve());

        setTimeout(() => {
          primaryLog('Forced shutdown after timeout');
          resolve();
        }, 3000);
      });
    }

    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

export { createServer };