import http from "http";
import https from "https";
import type { Adapter, ServerConfig } from "@/types";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (routesDir: string) => {
    return async (config: ServerConfig = {}) => {
        const { isDev, port } = config;
        await loadRoutes(routesDir);
      
        if (isDev) {
          watchRoutes(routesDir);
        }
      
        const requestListener: http.RequestListener = async (req, res) => {
          try {
            const route = findRoute(req.url || "/", req.method || "GET");
      
            if (!route) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Route not found" }));
              return;
            }
      
            if ("error" in route) {
              const status = route.status || 500;
              res.writeHead(status, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: route.error }));
              return;
            }
      
            (req as any).params = route.params;
            await route.handler(req, res);
          } catch (error) {
            console.error("Server error:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        };
      
        const server = isDev
          ? http.createServer(requestListener)
          : https.createServer(
              {
                /* HTTPs options  */
              },
              requestListener
            ); // TODO: add HTTPS options
      
        server.listen(port, () => {
          console.log(
            `🚀 Server started on ${isDev ? "http" : "https"}://localhost:${port} ${
              isDev ? "(dev)" : ""
            }`
          );
        });
      
        return server;
    };
  },
  transformRequest: (req) => enhanceRequest(req),
  transformResponse: (res) => enhanceResponse(res),
};
