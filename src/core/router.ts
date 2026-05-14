import fs from "fs/promises";
import path from "path";
import type { ServerlessRoute } from "@/types";
import { loadMiddlewares } from "./middleware";
import { primaryLog } from "@/utils/logs";

function parsePattern(pattern: string) {
  const match = pattern.match(/^\[(\w+)(\??)]/);
  if (match) return { name: match[1], isParam: true, isOptional: match[2] === "?" };
  return { name: pattern, isParam: false, isOptional: false };
}

interface RouteMatchResult {
  handler: Function | null;
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
  // null-prototype object: avoids accidental prototype key collisions (e.g. "toString")
  handlers: Record<string, Function>;
  staticChildren: Map<string, RouteNode>;
  paramChild: { name: string; node: RouteNode; isOptional: boolean } | null;
  wildcardHandler: Record<string, Function> | null;
  isEndpoint: boolean;
}

const CACHE_MAX = 1000;
const CACHE_EVICT = 100;

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
      handlers: Object.create(null),
      staticChildren: new Map(),
      paramChild: null,
      wildcardHandler: null,
      isEndpoint: false,
    };
  }

  addRoute(method: string, routePath: string, handler: Function): Router {
    const segments = routePath.split("/").filter(Boolean);
    let node = this.rootNode;

    for (const segment of segments) {
      const parsed = parsePattern(segment);
      if (parsed.isParam) {
        if (!node.paramChild) {
          node.paramChild = { name: parsed.name, node: this.createNode(), isOptional: parsed.isOptional };
        }
        node = node.paramChild.node;
      } else if (segment === "*") {
        if (!node.wildcardHandler) node.wildcardHandler = Object.create(null);
        node.wildcardHandler![method] = handler;
        this.cachedRoutes.clear();
        return this;
      } else {
        if (!node.staticChildren.has(segment)) node.staticChildren.set(segment, this.createNode());
        node = node.staticChildren.get(segment)!;
      }
    }

    node.isEndpoint = true;
    node.handlers[method] = handler;
    this.routeCount++;
    this.cachedRoutes.clear();
    return this;
  }

  findRoute(method: string, url: string): RouteMatchResult {
    const normalizedUrl = url === "/" ? "/" : url.replace(/\/+$/, "");
    const cacheKey = method + ":" + normalizedUrl;

    const cached = this.cachedRoutes.get(cacheKey);
    if (cached) return cached;

    const segments = normalizedUrl === "/" ? [] : normalizedUrl.split("/").filter(Boolean);
    // Reusable scratch object — traverse mutates and restores it, copies on return
    const params: Record<string, string> = Object.create(null);

    const result = this.traverse(this.rootNode, segments, method, params, 0)
      ?? { handler: null, params: Object.create(null) };

    if (this.cachedRoutes.size >= CACHE_MAX) {
      let evicted = 0;
      for (const key of this.cachedRoutes.keys()) {
        this.cachedRoutes.delete(key);
        if (++evicted >= CACHE_EVICT) break;
      }
    }
    this.cachedRoutes.set(cacheKey, result);
    return result;
  }

  private traverse(
    node: RouteNode,
    segments: string[],
    method: string,
    params: Record<string, string>,
    index: number,
  ): RouteMatchResult | null {
    if (index === segments.length) {
      if (node.isEndpoint) {
        const handler =
          node.handlers[method] ??
          (method === "HEAD" ? node.handlers["GET"] : undefined) ??
          node.handlers[""];
        if (handler) return { handler, params: { ...params } };

        // Path exists but method not registered — collect allowed methods in one pass
        const allowed = Object.keys(node.handlers).filter((m) => m !== "");
        return { handler: null, params: {}, allowedMethods: allowed };
      }

      // Optional param child at end of URL
      const oc = node.paramChild;
      if (oc?.isOptional && oc.node.isEndpoint) {
        const handler =
          oc.node.handlers[method] ??
          (method === "HEAD" ? oc.node.handlers["GET"] : undefined) ??
          oc.node.handlers[""];
        if (handler) return { handler, params: { ...params } };
      }

      return null;
    }

    const segment = segments[index];

    // Static takes priority over param
    const staticChild = node.staticChildren.get(segment);
    if (staticChild) {
      const found = this.traverse(staticChild, segments, method, params, index + 1);
      if (found) return found;
    }

    // Param — mutate params, restore on backtrack
    if (node.paramChild) {
      const { name, node: child } = node.paramChild;
      params[name] = segment;
      const found = this.traverse(child, segments, method, params, index + 1);
      if (found) return found;
      delete params[name];
    }

    // Wildcard
    if (node.wildcardHandler) {
      const handler = node.wildcardHandler[method] ?? node.wildcardHandler[""];
      const rest = segments.slice(index).join("/");
      if (handler) return { handler, params: { ...params, "*": rest } };
      const allowed = Object.keys(node.wildcardHandler).filter((m) => m !== "");
      if (allowed.length > 0) return { handler: null, params: { ...params, "*": rest }, allowedMethods: allowed };
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

        const indexFile = entries.find(
          (e) => !e.isDirectory() && (e.name === "index.ts" || e.name === "index.js"),
        );

        if (indexFile) {
          try {
            const absolutePath = path.resolve(path.join(dir, indexFile.name));
            const module = await import(`${absolutePath}?update=${Date.now()}`);

            const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
            const routePath = "/" + currentPath.join("/");
            let registered = false;

            for (const method of methods) {
              if (typeof module[method] === "function") {
                self.addRoute(method, routePath, module[method]);
                registered = true;
              }
            }

            if (!registered && typeof module.default === "function") {
              self.addRoute("GET", routePath, module.default);
            }

            if (self.verbose) primaryLog(`Route loaded: ${routePath}`);
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
            await scanDir(path.join(dir, entry.name), [...currentPath, segmentName]);
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    }

    await scanDir(routesDir);
    this.lastLoaded = Date.now();
    if (this.verbose) primaryLog(`Loading completed: ${this.routeCount} routes`);
    return true;
  }

  getStats() {
    return {
      routeCount: this.routeCount,
      lastLoaded: this.lastLoaded,
      uptime: Date.now() - this.lastLoaded,
      cacheSize: this.cachedRoutes.size,
    };
  }

  setVerbose(verbose: boolean): Router {
    this.verbose = verbose;
    return this;
  }
}

const router = new Router();

function isRouteError(obj: any): obj is RouteError {
  return obj && typeof obj === "object" && "error" in obj;
}

export function registerRoutes(routes: ServerlessRoute[]): void {
  for (const { path, handlers } of routes) {
    const normalizedPath = path.replace(/:(\w+\??)/g, (_, name) =>
      name.endsWith("?") ? `[${name.slice(0, -1)}?]` : `[${name}]`,
    );
    for (const [method, handler] of Object.entries(handlers)) {
      if (typeof handler === "function") router.addRoute(method, normalizedPath, handler);
    }
  }
}

export async function loadRoutes(routesDir: string) {
  return router.loadRoutes(routesDir);
}

export function findRoute(url: string, method: string = "GET"): FindRouteResult {
  const result = router.findRoute(method, url);

  if (!result.handler) {
    if (result.allowedMethods?.length) {
      return { error: "Method Not Allowed", status: 405, allowedMethods: result.allowedMethods } as RouteError;
    }
    return null;
  }

  return { handler: result.handler, params: result.params };
}

export function getRoutesDir(customDir?: string) {
  return path.resolve(process.cwd(), customDir || process.env.ROUTES_DIR || "routes");
}

export function getRouterStats() {
  return router.getStats();
}

export function setVerboseLogging(verbose: boolean) {
  router.setVerbose(verbose);
}

export { router, isRouteError };
