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

const pathMiddlewares = new Map<string, {
  beforeRequest: MiddlewareCallback[];
  afterRequest: MiddlewareCallback[];
  onError: MiddlewareCallback[];
}>();


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

async function runMiddlewares(
  middlewareName: MiddlewareType,
  req: Request,
  res: Response,
  context?: any
): Promise<boolean> {
  const hasGlobalMiddlewares = globalMiddlewares[middlewareName].length > 0;
  const hasPathMiddlewares = pathMiddlewares.size > 0;
  
  if (!hasGlobalMiddlewares && !hasPathMiddlewares) {
    return true;
  }
  
  for (const middleware of globalMiddlewares[middlewareName]) {
    try {
      const result = await middleware(req, res, context);
      if (result === false) return false;
    } catch (error) {
      if (middlewareName !== "onError") {
        try {
          for (const errorHandler of globalMiddlewares.onError) {
            await errorHandler(req, res, { error, phase: middlewareName });
          }
        } catch (e) {
          console.error("Error in error handler:", e);
        }
      }
      return false;
    }
  }

  if (pathMiddlewares.size === 0) {
    return true;
  }
  
  const urlPath = req.url?.split('?')[0] || '/';
  
  for (const [middlewarePath, middlewares] of pathMiddlewares.entries()) {
    if (urlPath === middlewarePath || 
        (middlewarePath !== '/' && urlPath.startsWith(middlewarePath))) {
      
      if (middlewares[middlewareName].length === 0) continue;
      
      for (const middleware of middlewares[middlewareName]) {
        try {
          const result = await middleware(req, res, context);
          if (result === false) return false;
        } catch (error) {
          if (middlewareName !== "onError") {
            for (const errorHandler of middlewares.onError) {
              await errorHandler(req, res, { error, phase: middlewareName });
            }
          }
          return false;
        }
      }
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

export { addMiddleware, runMiddlewares, loadMiddlewares };