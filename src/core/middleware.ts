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
  MiddlewareName: MiddlewareType,
  callback: MiddlewareCallback
) {
  if (!globalMiddlewares[MiddlewareName]) {
    throw new Error(`Middleware "${MiddlewareName}" unknown`);
  }
  globalMiddlewares[MiddlewareName].push(callback);
  return {
    remove: () => {
      const index = globalMiddlewares[MiddlewareName].indexOf(callback);
      if (index !== -1) {
        globalMiddlewares[MiddlewareName].splice(index, 1);
      }
    },
  };
}

const pathMatchCache = new Map<string, boolean>();

function isPathApplicable(middlewarePath: string, requestPath: string): boolean {
  const cacheKey = `${middlewarePath}|${requestPath}`;
  
  if (pathMatchCache.has(cacheKey)) {
    return pathMatchCache.get(cacheKey)!;
  }
  
  const normalizedMiddlewarePath = middlewarePath.endsWith('/') ? middlewarePath : `${middlewarePath}/`;
  const normalizedRequestPath = requestPath.endsWith('/') ? requestPath : `${requestPath}/`;
  
  let result = false;
  if (normalizedMiddlewarePath === '/') {
    result = true;
  } else {
    result = normalizedRequestPath.startsWith(normalizedMiddlewarePath);
  }
  
  if (pathMatchCache.size > 1000) {
    const keysToDelete = Array.from(pathMatchCache.keys()).slice(0, 100);
    keysToDelete.forEach(key => pathMatchCache.delete(key));
  }
  
  pathMatchCache.set(cacheKey, result);
  return result;
}

const middlewareTree = new Map<string, Set<string>>();

function buildMiddlewareTree() {
  const allPaths = Array.from(pathMiddlewares.keys());
  
  for (const path of allPaths) {
    const segments = path.split('/').filter(Boolean);
    let currentPath = '';
    
    for (let i = 0; i <= segments.length; i++) {
      if (!middlewareTree.has(currentPath)) {
        middlewareTree.set(currentPath, new Set());
      }
      
      middlewareTree.get(currentPath)!.add(path);
      
      if (i < segments.length) {
        currentPath += '/' + segments[i];
      }
    }
  }
}

async function runMiddlewares(
  MiddlewareName: MiddlewareType,
  req: Request,
  res: Response,
  context?: any
): Promise<boolean> {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );
  const urlPath = url.pathname;

  const sortedPaths = Array.from(pathMiddlewares.keys()).sort((a, b) => {
    return b.length - a.length;
  });

  for (const Middleware of globalMiddlewares[MiddlewareName]) {
    try {
      const result = await Middleware(req, res, context);
      if (result === false) return false;
    } catch (error) {
      console.error(
        `Error while executing global Middleware "${MiddlewareName}":`,
        error
      );
      if (MiddlewareName !== "onError") {
        await runMiddlewares("onError", req, res, {
          error,
          phase: MiddlewareName,
        });
      }
      return false;
    }
  }

  for (const MiddlewarePath of sortedPaths) {
    if (isPathApplicable(MiddlewarePath, urlPath)) {
      const Middlewares = pathMiddlewares.get(MiddlewarePath)![MiddlewareName];
      for (const Middleware of Middlewares) {
        try {
          const result = await Middleware(req, res, context);
          if (result === false) return false;
        } catch (error) {
          console.error(
            `Error while executing Middleware "${MiddlewareName}" for path "${MiddlewarePath}":`,
            error
          );
          if (MiddlewareName !== "onError") {
            await runMiddlewares("onError", req, res, {
              error,
              phase: MiddlewareName,
              path: MiddlewarePath,
            });
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

      const MiddlewareFile = entries.find(
        (entry) =>
          entry.name === "+middleware.ts" || entry.name === "+middleware.js"
      );

      if (MiddlewareFile) {
        const fullPath = path.join(dir, MiddlewareFile.name);
        try {
          const absolutePath = path.resolve(fullPath);
          if (require.cache[require.resolve(absolutePath)]) {
            delete require.cache[require.resolve(absolutePath)];
          }

          const MiddlewareModule = await import(
            `${absolutePath}?update=${Date.now()}`
          );

          pathMiddlewares.set(prefix, {
            beforeRequest: Array.isArray(MiddlewareModule.beforeRequest)
              ? MiddlewareModule.beforeRequest
              : MiddlewareModule.beforeRequest
              ? [MiddlewareModule.beforeRequest]
              : [],
            afterRequest: Array.isArray(MiddlewareModule.afterRequest)
              ? MiddlewareModule.afterRequest
              : MiddlewareModule.afterRequest
              ? [MiddlewareModule.afterRequest]
              : [],
            onError: Array.isArray(MiddlewareModule.onError)
              ? MiddlewareModule.onError
              : MiddlewareModule.onError
              ? [MiddlewareModule.onError]
              : [],
          });
        } catch (error) {
          console.error(
            `Error loading middlewares for ${prefix}:`,
            error
          );
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          await scanDir(
            fullPath,
            `${prefix === "/" ? "" : prefix}/${entry.name}`
          );
        }
      }
    } catch (error) {
      console.error(`Error while scanning the directory ${dir}:`, error);
    }
  }

  await scanDir(routesDir, "/");
}

export { addMiddleware, runMiddlewares, loadMiddlewares };
