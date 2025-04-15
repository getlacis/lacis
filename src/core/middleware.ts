import type {
  MiddlewareCallback,
  MiddlewareType,
  PathMiddlewares,
  Request,
  Response,
} from "@/types";
import path from "path";
import fs from "fs/promises";

const globalMiddlewares: {
  beforeRequest: MiddlewareCallback[];
  afterRequest: MiddlewareCallback[];
  onError: MiddlewareCallback[];
} = {
  beforeRequest: [],
  afterRequest: [],
  onError: [],
};

const pathMiddlewares: PathMiddlewares = new Map();

function addMiddleware(
  middlewareName: MiddlewareType,
  callback: MiddlewareCallback
) {
  globalMiddlewares[middlewareName].push(callback);
  
  return {
    remove: () => {
      const index = globalMiddlewares[middlewareName].indexOf(callback);
      if (index !== -1) {
        globalMiddlewares[middlewareName].splice(index, 1);
      }
    },
  };
}

function addPathMiddleware(
  path: string,
  type: MiddlewareType,
  callback: MiddlewareCallback
) {
  const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');
  
  if (!pathMiddlewares.has(normalizedPath)) {
    pathMiddlewares.set(normalizedPath, {
      beforeRequest: [],
      afterRequest: [],
      onError: []
    });
  }
  
  const middlewares = pathMiddlewares.get(normalizedPath)!;
  middlewares[type].push(callback);
  
  return {
    remove: () => {
      if (pathMiddlewares.has(normalizedPath)) {
        const middlewares = pathMiddlewares.get(normalizedPath)!;
        const index = middlewares[type].indexOf(callback);
        if (index !== -1) {
          middlewares[type].splice(index, 1);
        }
      }
    }
  };
}

function collectMiddleware(url: string) {
  const normalizedUrl = url === '/' ? '/' : url.replace(/\/+$/, '');
  const segments = normalizedUrl.split('/').filter(Boolean);
  
  const result = {
    beforeRequest: [...globalMiddlewares.beforeRequest],
    afterRequest: [...globalMiddlewares.afterRequest],
    onError: [...globalMiddlewares.onError]
  };
  
  let currentPath = '';
  
  if (pathMiddlewares.has('/')) {
    const rootMiddleware = pathMiddlewares.get('/')!;
    result.beforeRequest.push(...rootMiddleware.beforeRequest);
    result.afterRequest.push(...rootMiddleware.afterRequest);
    result.onError.push(...rootMiddleware.onError);
  }
  
  for (const segment of segments) {
    currentPath += '/' + segment;
    
    if (pathMiddlewares.has(currentPath)) {
      const middleware = pathMiddlewares.get(currentPath)!;
      result.beforeRequest.push(...middleware.beforeRequest);
      result.afterRequest.push(...middleware.afterRequest);
      result.onError.push(...middleware.onError);
    }
  }
  
  return result;
}

async function runMiddlewares(
  middlewareName: MiddlewareType,
  req: Request,
  res: Response,
  context?: any
): Promise<boolean> {
  const url = req.url?.split('?')[0] || '/';
  const middleware = collectMiddleware(url);
  
  if (middleware[middlewareName].length === 0) {
    return true;
  }
  
  for (const handler of middleware[middlewareName]) {
    try {
      const result = await handler(req, res, context);
      if (result === false) return false;
    } catch (error) {
      if (middlewareName !== "onError") {
        try {
          for (const errorHandler of middleware.onError) {
            await errorHandler(req, res, { error, phase: middlewareName });
          }
        } catch (e) {
          console.error("Error in error handler:", e);
        }
      }
      return false;
    }
  }

  return true;
}

async function loadMiddlewares(routesDir: string) {
  pathMiddlewares.clear();
  
  async function scanDir(dir: string, prefix = "") {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      const middlewareFile = entries.find(
        entry => entry.name === "+middleware.ts" || entry.name === "+middleware.js"
      );
      
      if (middlewareFile) {
        const fullPath = path.join(dir, middlewareFile.name);
        try {
          const absolutePath = path.resolve(fullPath);
          if (require.cache[require.resolve(absolutePath)]) {
            delete require.cache[require.resolve(absolutePath)];
          }
          
          const middlewareModule = await import(absolutePath);
          
          if (!pathMiddlewares.has(prefix)) {
            pathMiddlewares.set(prefix, {
              beforeRequest: [],
              afterRequest: [],
              onError: [],
            });
          }
          
          if (middlewareModule.beforeRequest) {
            const middlewares = Array.isArray(middlewareModule.beforeRequest) 
              ? middlewareModule.beforeRequest 
              : [middlewareModule.beforeRequest];
            pathMiddlewares.get(prefix)!.beforeRequest.push(...middlewares);
          }
          
          if (middlewareModule.afterRequest) {
            const middlewares = Array.isArray(middlewareModule.afterRequest) 
              ? middlewareModule.afterRequest 
              : [middlewareModule.afterRequest];
            pathMiddlewares.get(prefix)!.afterRequest.push(...middlewares);
          }
          
          if (middlewareModule.onError) {
            const middlewares = Array.isArray(middlewareModule.onError) 
              ? middlewareModule.onError 
              : [middlewareModule.onError];
            pathMiddlewares.get(prefix)!.onError.push(...middlewares);
          }
        } catch (error) {
          console.error(`Error loading middleware for ${prefix}:`, error);
        }
      }
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scanDir(
            path.join(dir, entry.name),
            `${prefix === "/" ? "" : prefix}/${entry.name}`
          );
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }
  
  await scanDir(routesDir, "/");
}

function getPathMiddlewares() {
  return pathMiddlewares;
}

export { 
  addMiddleware, 
  addPathMiddleware,
  runMiddlewares, 
  loadMiddlewares, 
  getPathMiddlewares, 
  collectMiddleware 
};