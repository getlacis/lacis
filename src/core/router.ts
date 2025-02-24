import fs from "fs/promises";
import path from "path";
import type { Route, RouteHandlers } from "@/types/index";
import pathToPattern from "@/utils/pathUtils";
import { loadMiddlewares } from "./middleware";
let routes: Route[] = [];

function clearModuleCache(modulePath: string) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
}

async function loadRoutes(routesDir: string) {
  routes = [];
  const staticRoutes: Route[] = [];
  const dynamicRoutes: Route[] = [];

  await loadMiddlewares(routesDir);

  async function scanDir(dir: string, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath, `${prefix}/${entry.name}`);
        continue;
      }

      if(entry.name.endsWith("+middleware.ts") || entry.name.endsWith("+middleware.js"))
      if(!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;

      const routePath = `${prefix}/${entry.name.replace(/\.(ts|js)$/, "")}`;
      const { pattern, params } = pathToPattern(routePath);

      try {
        const absolutePath = path.resolve(fullPath);
        clearModuleCache(absolutePath);
        const module = await import(`${absolutePath}?update=${Date.now()}`);

        const handlers: RouteHandlers = {};

        ["GET", "POST", "PUT", "DELETE", "PATCH"].forEach((method) => {
          if (typeof module[method] === "function") {
            handlers[method as keyof RouteHandlers] = module[method];
          }
        });

        if (typeof module.default === "function" && !handlers.GET) {
          handlers.GET = module.default;
        }

        if (Object.keys(handlers).length > 0) {
          const route = { pattern, params, handlers };

          if (params.length > 0) {
            dynamicRoutes.push(route);
          } else {
            staticRoutes.push(route);
          }
        }
      } catch (error) {
        console.error(
          `Erreur lors du chargement de la route ${routePath}:`,
          error
        );
      }
    }
  }

  await scanDir(routesDir);

  routes = [...staticRoutes, ...dynamicRoutes];
}

function findRoute(url: string, method: string = "GET") {
  const path = url.split("?")[0] || "/";

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.params.forEach((param, i) => {
        params[param] = match[i + 1];
      });

      const handler = route.handlers[method as keyof RouteHandlers];
      if (!handler) {
        return { error: "Method Not Allowed", status: 405 };
      }

      return { handler, params };
    }
  }
  return null;
}

function getRoutesDir(customDir?: string) {
  const projectRoot = process.cwd();
  const routesDir = customDir || process.env.ROUTES_DIR || "routes";
  console.log(path.resolve(projectRoot, routesDir));
  return path.resolve(projectRoot, routesDir);
}

export { loadRoutes, findRoute, getRoutesDir };
