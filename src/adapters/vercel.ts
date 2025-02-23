import type { Adapter, RouteHandlers } from "@/types";
import type { Route, Handler } from "@/types";
import type { VercelRequest, VercelResponse } from "@/types";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { findRoute } from "@core/router";
import { IncomingMessage, ServerResponse } from "http";

export const vercelAdapter: Adapter = {
  name: "vercel",
  createHandler: (routesDir: string) => {
    return async (req: VercelRequest, res: VercelResponse) => {
      const route = findRoute(
        req.url || "/",
        req.method || "GET"
      ) as Route | null;
      const method = req.method as keyof RouteHandlers;

      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }

      const handler = route.handlers[method] as Handler;

      if (!handler) {
        return res.status(404).json({ error: "Method not allowed" });
      }
      
      try {
        await handler(req as IncomingMessage, res as unknown as ServerResponse);
      } catch (error) {
        console.error("Handler error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    };
  },
};
