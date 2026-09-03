import type { CorsConfig, Request, Response } from '@/types';
import type { MiddlewareCallback } from '@/types/middleware';
import { addMiddleware } from './middleware';
import { primaryLog } from '@/utils/logs';

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

  // `*` + credentials is forbidden by the spec: reflecting an arbitrary origin
  // with Allow-Credentials would let any site make credentialed requests. Refuse
  // the combination rather than reflect every origin.
  const allowCredentials = !!config.credentials && !isWildcard;
  if (config.credentials && isWildcard) {
    primaryLog('[cors] credentials:true with origin:"*" is unsafe and disabled — set an explicit origin allowlist to use credentials');
  }

  if (config.origin instanceof RegExp) {
    const src = config.origin.source;
    if (!src.startsWith('^') || !src.endsWith('$')) {
      primaryLog(`[cors] origin RegExp /${src}/ is not anchored (^…$) and may match unintended hosts`);
    }
  }

  return async (req: Request, res: Response) => {
    const origin = req.getHeader('origin');

    if (!origin) return;
    if (!isOriginAllowed(origin, config.origin)) return;

    if (isWildcard) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (allowCredentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
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
