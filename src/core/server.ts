import { getAdapter } from '@/adapters';
import { defaultConfig, type ServerConfig } from "@/config/serverConfig";
import { loadRoutes } from './router';
import { watchRoutes } from './watcher';
import type { Server } from 'http';
import { primaryLog } from '@/utils/logs';

async function createServer(
  routesDir: string,
  config: ServerConfig = defaultConfig
) {
  const { platform = 'node' } = config;
  
  if (config.isDev) {
    watchRoutes(routesDir);
    primaryLog("🔥 Dev mode activated");
  }

  const adapter = getAdapter(platform);
  const handler = adapter.createHandler(routesDir);

  switch (platform) {
    case 'node':
      return (handler as (config?: ServerConfig) => Server)(config);
    case 'bun':
      return (handler as (config?: ServerConfig) => void)(config);
    case 'vercel':
    case 'netlify':
      return handler;
    default:
      throw new Error(`Platform "${platform}" not supported`);
  }
}
export { createServer };
