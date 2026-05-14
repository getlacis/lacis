import type { CorsConfig, Request, Response } from '@/types';
import type { MiddlewareCallback } from '@/types/middleware';
import { addMiddleware } from './middleware';

function isOriginAllowed(origin: string, allowed: CorsConfig['origin']): boolean {
  if (!allowed || allowed === '*') return true;
  if (typeof allowed === 'string') return origin === allowed;
  if (Array.isArray(allowed)) return allowed.includes(origin);
  if (allowed instanceof RegExp) return allowed.test(origin);
  if (typeof allowed === 'function') return allowed(origin);
  return false;
}

function createCorsMiddleware(config: CorsConfig): MiddlewareCallback {
  const methods = (config.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']).join(', ');
  const allowedHeaders = (config.allowedHeaders ?? ['Content-Type', 'Authorization']).join(', ');
  const exposedHeaders = config.exposedHeaders?.join(', ');
  const maxAge = config.maxAge != null ? String(config.maxAge) : null;
  const isWildcard = !config.origin || config.origin === '*';

  return async (req: Request, res: Response) => {
    const origin = req.getHeader('origin');

    if (!origin) return;
    if (!isOriginAllowed(origin, config.origin)) return;

    // credentials:true is incompatible with wildcard, reflect the actual origin instead
    const useWildcard = isWildcard && !config.credentials;
    res.setHeader('Access-Control-Allow-Origin', useWildcard ? '*' : origin);
    if (!useWildcard) res.setHeader('Vary', 'Origin');
    if (config.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (exposedHeaders) res.setHeader('Access-Control-Expose-Headers', exposedHeaders);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
      if (maxAge) res.setHeader('Access-Control-Max-Age', maxAge);
      res.status(204);
      res.end();
      return false;
    }
  };
}

function registerCorsConfig(cors?: CorsConfig): void {
  if (!cors) return;
  addMiddleware('beforeRequest', createCorsMiddleware(cors));
}

export { createCorsMiddleware, registerCorsConfig };
