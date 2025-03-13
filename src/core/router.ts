import fs from "fs/promises";
import path from "path";
import type { RouteHandlers } from "@/types/index";
import { loadMiddlewares } from "./middleware";

interface RadixNode {
  handler: RouteHandlers | null;
  children: Map<string, RadixNode>;
  paramChild: { name: string; node: RadixNode } | null;
  isEndpoint: boolean;
}

const router = {
  staticRoutes: new Map<string, RouteHandlers>(),
  
  root: createRadixNode(),
  
  stats: {
    staticRoutes: 0,
    dynamicRoutes: 0,
    totalHits: 0,
    lastLoaded: 0
  },
  
  verbose: false
};

function createRadixNode(): RadixNode {
  return {
    handler: null,
    children: new Map(),
    paramChild: null,
    isEndpoint: false
  };
}

function clearModuleCache(modulePath: string) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
}

function isParamFolder(folderName: string): { isParam: boolean; paramName: string } {
  const match = folderName.match(/^\[(\w+)]/);
  if (match) {
    return { 
      isParam: true, 
      paramName: match[1]
    };
  }
  
  return { isParam: false, paramName: '' };
}

function normalizePath(url: string): string {
  return url === '/' ? url : url.replace(/\/+$/, '');
}

function insertRoute(routePath: string, handlers: RouteHandlers) {
  if (!routePath.includes('[')) {
    router.staticRoutes.set(normalizePath(routePath), handlers);
    router.stats.staticRoutes++;
    return;
  }
  
  router.stats.dynamicRoutes++;
  
  const segments = routePath.split('/').filter(Boolean);
  let currentNode = router.root;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const { isParam, paramName } = isParamFolder(segment);
    
    if (isParam) {
      if (!currentNode.paramChild) {
        currentNode.paramChild = {
          name: paramName,
          node: createRadixNode()
        };
      }
      currentNode = currentNode.paramChild.node;
    } else {
      if (!currentNode.children.has(segment)) {
        currentNode.children.set(segment, createRadixNode());
      }
      currentNode = currentNode.children.get(segment)!;
    }
  }
  
  currentNode.isEndpoint = true;
  currentNode.handler = handlers;
}

async function loadRoutes(routesDir: string) {
  router.staticRoutes.clear();
  router.root = createRadixNode();
  router.stats.staticRoutes = 0;
  router.stats.dynamicRoutes = 0;
  
  await loadMiddlewares(routesDir);
  
  async function scanDir(dir: string, currentPath: string[] = []) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      const indexFile = entries.find(entry => 
        !entry.isDirectory() && 
        (entry.name === 'index.ts' || entry.name === 'index.js')
      );
      
      if (indexFile) {
        try {
          const fullPath = path.join(dir, indexFile.name);
          const absolutePath = path.resolve(fullPath);
          
          clearModuleCache(absolutePath);
          
          // Importer le module
          const module = await import(`${absolutePath}?update=${Date.now()}`);
          
          const handlers: RouteHandlers = {};
          const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
          
          methods.forEach(method => {
            if (typeof module[method] === "function") {
              handlers[method as keyof RouteHandlers] = module[method];
            }
          });
          
          if (typeof module.default === "function" && !handlers.GET) {
            handlers.GET = module.default;
          }
          
          if (Object.keys(handlers).length > 0) {
            const routePath = '/' + currentPath.join('/');
            
            insertRoute(routePath, handlers);
            
            if (router.verbose) {
              console.log(`Route chargée: ${routePath}`);
            }
          }
        } catch (error) {
          console.error(`Erreur lors du chargement de l'index dans ${dir}:`, error);
        }
      }
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scanDir(
            path.join(dir, entry.name),
            [...currentPath, entry.name]
          );
        }
      }
    } catch (error) {
      console.error(`Erreur lors du scan du dossier ${dir}:`, error);
    }
  }
  
  await scanDir(routesDir);
  
  router.stats.lastLoaded = Date.now();
  
  if (router.verbose) {
    console.log(`Chargement terminé: ${router.stats.staticRoutes} routes statiques, ${router.stats.dynamicRoutes} routes dynamiques`);
  }
  return true;
}

function findRoute(url: string, method: string = "GET") {
  const cleanPath = normalizePath(url.split('?')[0] || '/');
  router.stats.totalHits++;
  
  if (router.staticRoutes.has(cleanPath)) {
    const handlers = router.staticRoutes.get(cleanPath)!;
    const handler = handlers[method as keyof RouteHandlers];
    
    if (!handler) {
      return { error: "Method Not Allowed", status: 405 };
    }
    
    return { handler, params: {} };
  }
  
  const segments = cleanPath.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  
  let currentNode = router.root;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    if (currentNode.children.has(segment)) {
      currentNode = currentNode.children.get(segment)!;
      continue;
    }
    
    if (currentNode.paramChild) {
      params[currentNode.paramChild.name] = segment;
      currentNode = currentNode.paramChild.node;
      continue;
    }
    
    return null;
  }
  
  if (currentNode.isEndpoint && currentNode.handler) {
    const handler = currentNode.handler[method as keyof RouteHandlers];
    
    if (!handler) {
      return { error: "Method Not Allowed", status: 405 };
    }
    
    return { handler, params };
  }
  
  return null;
}

function getRoutesDir(customDir?: string) {
  const projectRoot = process.cwd();
  const routesDir = customDir || process.env.ROUTES_DIR || "routes";
  return path.resolve(projectRoot, routesDir);
}

function getRouterStats() {
  return {
    ...router.stats,
    uptime: Date.now() - router.stats.lastLoaded,
    routeCount: router.stats.staticRoutes + router.stats.dynamicRoutes,
    staticPaths: Array.from(router.staticRoutes.keys()),
  };
}

function setVerboseLogging(verbose: boolean) {
  router.verbose = verbose;
}

export { loadRoutes, findRoute, getRoutesDir, getRouterStats, setVerboseLogging };