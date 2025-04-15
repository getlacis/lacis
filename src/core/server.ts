import { getAdapter } from '@/adapters';
import { defaultConfig, type ServerConfig } from "@/config/serverConfig";
import { loadRoutes } from './router';
import type { Server } from 'http';
import { primaryLog } from '@/utils/logs';
import cluster from 'cluster';

let serverInstance: Server | null = null;
let isShuttingDown = false;

async function createServer(
  routesDir: string,
  config: ServerConfig = defaultConfig
) {
  const { platform = 'node' } = config;
  const verbose = config.isDev && cluster.isPrimary;
  
  try {
    await loadRoutes(routesDir);
    
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
        server = (handler as (config?: ServerConfig) => Server)(config);
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