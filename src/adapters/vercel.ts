import type { Adapter, ServerlessConfig, VercelRequest, VercelResponse, Request, Response } from "@/types";
import { findRoute, isRouteError, registerRoutes } from "@/core/router";
import { runMiddlewares, registerMiddlewareConfig, hasMiddlewares } from "@/core/middleware";
import { registerCorsConfig } from "@/core/cors";
import { applyRequestMethods, applyResponseMethods, extractPathname, handleAdapterError } from "@/utils/adapter-base";

export const vercelAdapter: Adapter = {
  name: "vercel",
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config === "string") {
      throw new Error(
        "vercelAdapter.createHandler() requires a ServerlessConfig object, not a routesDir string. " +
        "Import your routes manifest and pass { routes } instead."
      );
    }

    let initPromise: Promise<void> | null = null;

    const init = (): Promise<void> => {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        registerRoutes(config.routes);
        registerCorsConfig(config.cors);
        registerMiddlewareConfig(config.middleware);
      })();
      return initPromise;
    };

    return async (vercelReq: VercelRequest, vercelRes: VercelResponse) => {
      await init();

      applyRequestMethods(vercelReq);
      applyResponseMethods(vercelRes);

      // Single cast: Vercel's types omit the lacis-specific methods we just applied
      const req = vercelReq as unknown as Request;
      const res = vercelRes as unknown as Response;

      try {
        if (hasMiddlewares()) {
          const shouldContinue = await runMiddlewares("beforeRequest", req, res);
          if (shouldContinue === false || res.headersSent) return;
        }

        const route = findRoute(extractPathname(req.url ?? "/"), req.method ?? "GET");

        if (!route) {
          res.status(404).json({ error: "Route not found" });
          return;
        }

        if (isRouteError(route)) {
          res.status(route.status ?? 500).json({ error: route.error });
          return;
        }

        req.params = route.params;

        await route.handler(req, res);

        if (hasMiddlewares()) await runMiddlewares("afterRequest", req, res);
      } catch (error) {
        await handleAdapterError(req, res, error);
        if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
      }
    };
  },
};
