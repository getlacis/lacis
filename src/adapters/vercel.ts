import type { Adapter, ServerlessConfig, VercelRequest, VercelResponse } from "@/types";
import { findRoute, isRouteError, registerRoutes } from "@/core/router";
import { runMiddlewares, registerMiddlewareConfig } from "@/core/middleware";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { IncomingMessage, ServerResponse } from "http";

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
        registerMiddlewareConfig(config.middleware);
      })();
      return initPromise;
    };

    return async (req: VercelRequest, res: VercelResponse) => {
      await init();

      const enhancedReq = enhanceRequest(req as unknown as IncomingMessage);
      const enhancedRes = enhanceResponse(res as unknown as ServerResponse);

      const route = findRoute(req.url ?? "/", req.method ?? "GET");

      if (!route) {
        enhancedRes.status(404).json({ error: "Route not found" });
        return;
      }

      if (isRouteError(route)) {
        enhancedRes.status(route.status ?? 500).json({ error: route.error });
        return;
      }

      enhancedReq.params = route.params;

      try {
        const shouldContinue = await runMiddlewares("beforeRequest", enhancedReq, enhancedRes);
        if (shouldContinue === false || enhancedRes.headersSent) return;

        await route.handler(enhancedReq, enhancedRes);
        await runMiddlewares("afterRequest", enhancedReq, enhancedRes);
      } catch (error) {
        console.error("[zeno/vercel] Handler error:", error);
        await runMiddlewares("onError", enhancedReq, enhancedRes, { error });
        if (!enhancedRes.headersSent) {
          enhancedRes.status(500).json({ error: "Internal server error" });
        }
      }
    };
  },
};
