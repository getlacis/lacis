import fs from "fs/promises";
import path from "path";
import type { RouteHandlers } from "@/types";
import { loadMiddlewares } from "./middleware";
import { primaryLog } from "@/utils/logs";

function parsePattern(pattern: string) {
  const paramRegex = /^\[(\w+)(\??)]/;
  const isParam = paramRegex.test(pattern);
  
  if (isParam) {
    const [, name, optional] = pattern.match(paramRegex) || [];
    return {
      name,
      isParam: true,
      isOptional: optional === '?',
      pattern: null
    };
  }
  
  return {
    name: pattern,
    isParam: false,
    isOptional: false,
    pattern: null
  };
}

interface RouteMatchResult {
  handlers: Function[];
  params: Record<string, string>;
  allowedMethods?: string[];
}

interface RouteError {
  error: string;
  status?: number;
  allowedMethods?: string[];
}

type FindRouteResult = 
  | { handler: Function; params: Record<string, string> }
  | RouteError
  | null;

interface RouteNode {
  handlers: Record<string, Function[]>;
  staticChildren: Map<string, RouteNode>;
  paramChild: {
    name: string;
    node: RouteNode;
    isOptional: boolean;
  } | null;
  wildcardHandler: Record<string, Function[]> | null;
  isEndpoint: boolean;
}

class Router {
  private rootNode: RouteNode;
  private cachedRoutes: Map<string, RouteMatchResult>;
  private routeCount: number;
  private lastLoaded: number;
  private verbose: boolean;
  
  constructor() {
    this.rootNode = this.createNode();
    this.cachedRoutes = new Map();
    this.routeCount = 0;
    this.lastLoaded = 0;
    this.verbose = false;
  }
  
  private createNode(): RouteNode {
    return {
      handlers: {},
      staticChildren: new Map(),
      paramChild: null,
      wildcardHandler: null,
      isEndpoint: false
    };
  }
  
  addRoute(method: string, routePath: string, handler: Function): Router {
    const segments = routePath.split('/').filter(Boolean);
    let currentNode = this.rootNode;
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const parsed = parsePattern(segment);
      
      if (parsed.isParam) {
        if (!currentNode.paramChild) {
          currentNode.paramChild = {
            name: parsed.name,
            node: this.createNode(),
            isOptional: parsed.isOptional
          };
        }
        currentNode = currentNode.paramChild.node;
      } else if (segment === '*') {
        if (!currentNode.wildcardHandler) {
          currentNode.wildcardHandler = {};
        }
        if (!currentNode.wildcardHandler[method]) {
          currentNode.wildcardHandler[method] = [];
        }
        currentNode.wildcardHandler[method].push(handler);
        return this;
      } else {
        if (!currentNode.staticChildren.has(segment)) {
          currentNode.staticChildren.set(segment, this.createNode());
        }
        currentNode = currentNode.staticChildren.get(segment)!;
      }
    }
    
    currentNode.isEndpoint = true;
    
    if (!currentNode.handlers[method]) {
      currentNode.handlers[method] = [];
    }
    
    currentNode.handlers[method].push(handler);
    this.routeCount++;
    
    this.cachedRoutes.clear();
    
    return this;
  }
  
  findRoute(method: string, url: string): RouteMatchResult {
    const normalizedUrl = url === '/' ? '/' : url.replace(/\/+$/, '');
    
    const cacheKey = `${method}:${normalizedUrl}`;
    if (this.cachedRoutes.has(cacheKey)) {
      return this.cachedRoutes.get(cacheKey)!;
    }
    
    const segments = normalizedUrl.split('/').filter(Boolean);
    
    const result = this.findRouteRecursive(this.rootNode, segments, method, {});
    
    if (!result || result.handlers.length === 0) {
      const allowedMethods = this.getAllowedMethods(normalizedUrl);
      
      if (allowedMethods.length > 0) {
        const methodNotAllowedResult: RouteMatchResult = { 
          handlers: [], 
          params: {},
          allowedMethods 
        };
        
        this.cachedRoutes.set(cacheKey, methodNotAllowedResult);
        
        return methodNotAllowedResult;
      }
    }
    
    if (result) {
      this.cachedRoutes.set(cacheKey, result);
      
      if (this.cachedRoutes.size > 1000) {
        const keysToDelete = Array.from(this.cachedRoutes.keys()).slice(0, 100);
        keysToDelete.forEach(key => this.cachedRoutes.delete(key));
      }
    }
    
    return result || { handlers: [], params: {} };
  }
  
  private getAllowedMethods(url: string): string[] {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    const allowedMethods: string[] = [];
    
    for (const method of methods) {
      const result = this.findRouteRecursive(
        this.rootNode, 
        url.split('/').filter(Boolean), 
        method, 
        {}
      );
      
      if (result && result.handlers.length > 0) {
        allowedMethods.push(method);
      }
    }
    
    return allowedMethods;
  }
  
  private findRouteRecursive(
    node: RouteNode,
    segments: string[],
    method: string,
    params: Record<string, string>,
    index: number = 0
  ): RouteMatchResult | null {
    if (index === segments.length) {
      if (node.isEndpoint) {
        const handlers = [];
        
        if (node.handlers[method]) {
          handlers.push(...node.handlers[method]);
        }
        
        if (method === 'HEAD' && node.handlers['GET']) {
          handlers.push(...node.handlers['GET']);
        }
        
        if (node.handlers['']) {
          handlers.push(...node.handlers['']);
        }
        
        if (handlers.length > 0) {
          return { handlers, params: { ...params } };
        }
      }
      
      if (node.paramChild && node.paramChild.isOptional && node.paramChild.node.isEndpoint) {
        const childHandlers = [];
        
        if (node.paramChild.node.handlers[method]) {
          childHandlers.push(...node.paramChild.node.handlers[method]);
        }
        
        if (method === 'HEAD' && node.paramChild.node.handlers['GET']) {
          childHandlers.push(...node.paramChild.node.handlers['GET']);
        }
        
        if (node.paramChild.node.handlers['']) {
          childHandlers.push(...node.paramChild.node.handlers['']);
        }
        
        if (childHandlers.length > 0) {
          return { handlers: childHandlers, params: { ...params } };
        }
      }
      
      const availableMethods = Object.keys(node.handlers).filter(m => 
        m !== '' && node.handlers[m].length > 0
      );
      
      if (availableMethods.length > 0) {
        return { handlers: [], params: { ...params }, allowedMethods: availableMethods };
      }
      
      return null;
    }
    
    const segment = segments[index];
    let found = null;
    
    if (node.staticChildren.has(segment)) {
      found = this.findRouteRecursive(
        node.staticChildren.get(segment)!,
        segments,
        method,
        params,
        index + 1
      );
      
      if (found) return found;
    }
    
    if (node.paramChild) {
      const paramName = node.paramChild.name;
      const newParams = { ...params, [paramName]: segment };
      
      found = this.findRouteRecursive(
        node.paramChild.node,
        segments,
        method,
        newParams,
        index + 1
      );
      
      if (found) return found;
    }
    
    if (node.wildcardHandler && node.wildcardHandler[method]) {
      return {
        handlers: node.wildcardHandler[method],
        params: { ...params, '*': segments.slice(index).join('/') }
      };
    }
    
    if (node.wildcardHandler && node.wildcardHandler['']) {
      return {
        handlers: node.wildcardHandler[''],
        params: { ...params, '*': segments.slice(index).join('/') }
      };
    }
    
    if (node.wildcardHandler) {
      const availableMethods = Object.keys(node.wildcardHandler).filter(m => 
        m !== '' && node.wildcardHandler![m].length > 0
      );
      
      if (availableMethods.length > 0) {
        return {
          handlers: [],
          params: { ...params, '*': segments.slice(index).join('/') },
          allowedMethods: availableMethods
        };
      }
    }
    
    return null;
  }
  
  async loadRoutes(routesDir: string): Promise<boolean> {
    this.rootNode = this.createNode();
    this.cachedRoutes.clear();
    this.routeCount = 0;
    
    await loadMiddlewares(routesDir);
    
    const self = this; 
    
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
            
            if (require.cache[require.resolve(absolutePath)]) {
              delete require.cache[require.resolve(absolutePath)];
            }
            
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
              
              Object.entries(handlers).forEach(([method, handler]) => {
                self.addRoute(method, routePath, handler);
              });
              
              if (self.verbose) {
                primaryLog(`Route loaded: ${routePath}`);
              }
            }
          } catch (error) {
            console.error(`Error loading index in ${dir}:`, error);
          }
        }
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const paramMatch = entry.name.match(/^\[(\w+)(\??)]/);
            const segmentName = paramMatch 
              ? `[${paramMatch[1]}${paramMatch[2]}]` 
              : entry.name;
            
            await scanDir(
              path.join(dir, entry.name),
              [...currentPath, segmentName]
            );
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    }
    
    await scanDir(routesDir);
    
    this.lastLoaded = Date.now();
    
    if (this.verbose) {
      primaryLog(`Loading completed: ${this.routeCount} routes`);
    }
    
    return true;
  }

  getStats() {
    return {
      routeCount: this.routeCount,
      lastLoaded: this.lastLoaded,
      uptime: Date.now() - this.lastLoaded,
      cacheSize: this.cachedRoutes.size
    };
  }
  
  setVerbose(verbose: boolean): Router {
    this.verbose = verbose;
    return this;
  }
}

const router = new Router();

function isRouteError(obj: any): obj is RouteError {
  return obj && typeof obj === 'object' && 'error' in obj;
}

export async function loadRoutes(routesDir: string) {
  return router.loadRoutes(routesDir);
}

export function findRoute(url: string, method: string = "GET"): FindRouteResult {
  const result = router.findRoute(method, url);
  
  if (result.handlers.length === 0 && (!result.allowedMethods || result.allowedMethods.length === 0)) {
    return null;
  }
  
  if (result.handlers.length === 0 && result.allowedMethods && result.allowedMethods.length > 0) {
    return {
      error: "Method Not Allowed",
      status: 405,
      allowedMethods: result.allowedMethods
    } as RouteError;
  }
  
  return {
    handler: result.handlers[0],
    params: result.params
  };
}

export function getRoutesDir(customDir?: string) {
  const projectRoot = process.cwd();
  const routesDir = customDir || process.env.ROUTES_DIR || "routes";
  return path.resolve(projectRoot, routesDir);
}

export function getRouterStats() {
  return router.getStats();
}

export function setVerboseLogging(verbose: boolean) {
  router.setVerbose(verbose);
}

export { router, isRouteError };