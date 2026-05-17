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

// +middleware.global.ts: cascades to all descendants
const cascadeMiddlewares: PathMiddlewares = new Map();
// +middleware.ts: applies only to routes at this exact directory level
const exactMiddlewares: PathMiddlewares = new Map();

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

function addToMap(map: PathMiddlewares, normalizedPath: string, type: MiddlewareType, callback: MiddlewareCallback) {
  if (!map.has(normalizedPath)) {
    map.set(normalizedPath, { beforeRequest: [], afterRequest: [], onError: [] });
  }
  map.get(normalizedPath)![type].push(callback);
  return {
    remove: () => {
      const entry = map.get(normalizedPath);
      if (!entry) return;
      const index = entry[type].indexOf(callback);
      if (index !== -1) entry[type].splice(index, 1);
    },
  };
}

function addPathMiddleware(p: string, type: MiddlewareType, callback: MiddlewareCallback) {
  return addToMap(cascadeMiddlewares, p === "/" ? "/" : p.replace(/\/+$/, ""), type, callback);
}

function addExactPathMiddleware(p: string, type: MiddlewareType, callback: MiddlewareCallback) {
  return addToMap(exactMiddlewares, p === "/" ? "/" : p.replace(/\/+$/, ""), type, callback);
}

function pushFromMap(
  map: PathMiddlewares,
  key: string,
  result: { beforeRequest: MiddlewareCallback[]; afterRequest: MiddlewareCallback[]; onError: MiddlewareCallback[] }
) {
  const entry = map.get(key);
  if (!entry) return;
  result.beforeRequest.push(...entry.beforeRequest);
  result.afterRequest.push(...entry.afterRequest);
  result.onError.push(...entry.onError);
}

function collectMiddleware(url: string) {
  const normalizedUrl = url === "/" ? "/" : url.replace(/\/+$/, "");
  const segments = normalizedUrl.split("/").filter(Boolean);

  const result = {
    beforeRequest: [...globalMiddlewares.beforeRequest],
    afterRequest: [...globalMiddlewares.afterRequest],
    onError: [...globalMiddlewares.onError],
  };

  // Root cascade middleware always runs
  pushFromMap(cascadeMiddlewares, "/", result);

  // Root exact middleware only runs when requesting "/"
  if (normalizedUrl === "/") pushFromMap(exactMiddlewares, "/", result);

  let currentPath = "";
  for (const segment of segments) {
    currentPath += "/" + segment;
    pushFromMap(cascadeMiddlewares, currentPath, result);
    // Exact middleware only runs at the terminal segment
    if (currentPath === normalizedUrl) pushFromMap(exactMiddlewares, currentPath, result);
  }

  return result;
}

function hasMiddlewares(): boolean {
  return (
    globalMiddlewares.beforeRequest.length > 0 ||
    globalMiddlewares.afterRequest.length > 0 ||
    globalMiddlewares.onError.length > 0 ||
    cascadeMiddlewares.size > 0 ||
    exactMiddlewares.size > 0
  );
}

async function runMiddlewares(
  middlewareName: MiddlewareType,
  req: Request,
  res: Response,
  context?: any
): Promise<boolean> {
  const url = req.url?.split("?")[0] || "/";
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

function loadMiddlewareModule(
  module: any,
  map: PathMiddlewares,
  prefix: string
) {
  if (!map.has(prefix)) {
    map.set(prefix, { beforeRequest: [], afterRequest: [], onError: [] });
  }
  const entry = map.get(prefix)!;
  for (const type of ["beforeRequest", "afterRequest", "onError"] as const) {
    if (module[type]) {
      const handlers = Array.isArray(module[type]) ? module[type] : [module[type]];
      entry[type].push(...handlers);
    }
  }
}

async function loadMiddlewares(routesDir: string) {
  cascadeMiddlewares.clear();
  exactMiddlewares.clear();

  async function scanDir(dir: string, prefix = "") {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const [filename, map] of [
        ["+middleware.global.ts", cascadeMiddlewares],
        ["+middleware.global.js", cascadeMiddlewares],
        ["+middleware.ts", exactMiddlewares],
        ["+middleware.js", exactMiddlewares],
      ] as [string, PathMiddlewares][]) {
        const file = entries.find((e) => e.name === filename);
        if (!file) continue;
        try {
          const absolutePath = path.resolve(path.join(dir, file.name));
          const mod = await import(`${absolutePath}?update=${Date.now()}`);
          loadMiddlewareModule(mod, map, prefix);
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
  return cascadeMiddlewares;
}

function resetMiddlewares() {
  globalMiddlewares.beforeRequest = [];
  globalMiddlewares.afterRequest = [];
  globalMiddlewares.onError = [];
  cascadeMiddlewares.clear();
  exactMiddlewares.clear();
}

function registerMiddlewareConfig(config?: {
  beforeRequest?: MiddlewareCallback | MiddlewareCallback[];
  afterRequest?: MiddlewareCallback | MiddlewareCallback[];
  onError?: MiddlewareCallback | MiddlewareCallback[];
}) {
  if (!config) return;
  for (const type of ["beforeRequest", "afterRequest", "onError"] as const) {
    const handlers = config[type];
    if (handlers) {
      const arr = Array.isArray(handlers) ? handlers : [handlers];
      for (const h of arr) addMiddleware(type, h);
    }
  }
}

export {
  addMiddleware,
  addPathMiddleware,
  addExactPathMiddleware,
  runMiddlewares,
  loadMiddlewares,
  getPathMiddlewares,
  collectMiddleware,
  resetMiddlewares,
  registerMiddlewareConfig,
  hasMiddlewares,
};
