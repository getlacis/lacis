import http, { globalAgent } from "http";
import https from "https";
import type { Adapter, ServerConfig } from "@/types";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { runMiddlewares } from "@/core/middleware";

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (routesDir: string) => {

    const transformRequest = nodeAdapter.transformRequest!;
    const transformResponse = nodeAdapter.transformResponse!;

    return async (config: ServerConfig = {}) => {
        const { isDev, port, defaultHeaders, globalMiddlewares } = config;
        await loadRoutes(routesDir);
      
        if (isDev) {
          watchRoutes(routesDir);
        }
      
        const requestListener: http.RequestListener = async (req, res) => {
          const enhancedReq = transformRequest(req);
          const enhancedRes = transformResponse(res);

          try {

            if(defaultHeaders) {
              Object.entries(defaultHeaders).forEach(([key, value]) => {
                res.setHeader(key, value);
              });
            }

            if (globalMiddlewares?.beforeRequest) {
              const result = await globalMiddlewares.beforeRequest(enhancedReq, enhancedRes);
              if (!result) return;
            }

            const shouldContinue = await runMiddlewares('beforeRequest', enhancedReq, enhancedRes);

            if (!shouldContinue) return;

            const route = findRoute(enhancedReq.url || "/", enhancedReq.method || "GET");
      
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
      
            (enhancedReq as any).params = route.params;
            await route.handler(enhancedReq, enhancedRes);

            if (globalMiddlewares?.afterRequest) {
              await globalMiddlewares.afterRequest(enhancedReq, enhancedRes);
            }

            await runMiddlewares('afterRequest', enhancedReq, enhancedRes);
          } catch (error) {
            console.error("Server error:", error);

            if(globalMiddlewares?.onError) {
              await globalMiddlewares.onError(enhancedReq, enhancedRes, error);
            }

            await runMiddlewares('onError', enhancedReq, enhancedRes, error);
            
            if(!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
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
