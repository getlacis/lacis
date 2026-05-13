import type { Adapter } from "@/types";
import type { VercelRequest, VercelResponse } from "@/types";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { findRoute, isRouteError } from "@/core/router";
import { runMiddlewares } from "@/core/middleware";
import { IncomingMessage, ServerResponse } from "http";

export const vercelAdapter: Adapter = {
  name: "vercel",
  createHandler: (_routesDir: string) => {
    return async (req: VercelRequest, res: VercelResponse) => {
      const enhancedReq = enhanceRequest(req as unknown as IncomingMessage);
      const enhancedRes = enhanceResponse(res as unknown as ServerResponse);

      const route = findRoute(req.url || "/", req.method || "GET");

      if (!route) {
        enhancedRes.status(404).json({ error: "Route not found" });
        return;
      }

      if (isRouteError(route)) {
        enhancedRes.status(route.status || 500).json({ error: route.error });
        return;
      }

      enhancedReq.params = route.params;

      try {
        const shouldContinue = await runMiddlewares("beforeRequest", enhancedReq, enhancedRes);
        if (shouldContinue === false || enhancedRes.headersSent) return;

        await route.handler(enhancedReq, enhancedRes);

        await runMiddlewares("afterRequest", enhancedReq, enhancedRes);
      } catch (error) {
        console.error("Handler error:", error);
        await runMiddlewares("onError", enhancedReq, enhancedRes, { error });
        if (!enhancedRes.headersSent) {
          enhancedRes.status(500).json({ error: "Internal server error" });
        }
      }
    };
  },
};
