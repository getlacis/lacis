import { getAdapter } from '@/adapters';
import { defaultConfig, type ServerConfig } from "@/config/serverConfig";
import { loadRoutes, router } from './router';
import { buildOpenApiDoc } from './openapi';
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
    await loadRoutes(routesDir);

    if (config.openapi) {
      const doc = await buildOpenApiDoc(config.openapi);
      const openapiPath = config.openapi.path ?? "/openapi.json";
      router.addRoute("GET", openapiPath, (_req: any, res: any) => res.json(doc));
      if (verbose) primaryLog(`OpenAPI doc available at ${openapiPath}`);
    }

    if (verbose) {
      primaryLog("🚀 Serveur démarré");
      primaryLog(`📂 Routes chargées depuis: ${routesDir}`);
    }
    
    if (config.isDev) {
      if (verbose) {
        primaryLog("🔥 Mode de développement activé");
      }
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
        throw new Error(`Plateforme "${platform}" non supportée`);
    }

    setupGracefulShutdown();
    
    return server;
  } catch (error) {
    if (verbose) {
      primaryLog("❌ Erreur lors de la création du serveur:", error);
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
    
    primaryLog(`\nSignal ${signal} reçu, arrêt en cours...`);
        
    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise<void>((resolve) => {
        serverInstance!.close(() => resolve());
        
        setTimeout(() => {
          primaryLog('Fermeture forcée après délai');
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