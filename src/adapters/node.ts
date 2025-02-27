import http, { globalAgent } from "http";
import https from "https";
import cluster from "cluster";
import os from "os";
import type { Adapter, ServerConfig } from "@/types";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { addMiddleware, runMiddlewares } from "@/core/middleware";
import { createTimeoutMiddleware } from "@/utils/timeout";
import { primaryLog } from "@/utils/logs";

const configureHttpAgent = () => {
  globalAgent.maxSockets = 1000;
  globalAgent.keepAlive = true;
  globalAgent.maxFreeSockets = 256;
  globalAgent.timeout = 60000;

  https.globalAgent.maxSockets = 1000;
  https.globalAgent.keepAlive = true;
  https.globalAgent.maxFreeSockets = 256;
  https.globalAgent.timeout = 60000;

  //globalAgent.setNoDelay(true);
  //https.globalAgent.setNoDelay(true);

  return {
    http: globalAgent,
    https: https.globalAgent,
  };
};

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (routesDir: string) => {
    const transformRequest = nodeAdapter.transformRequest!;
    const transformResponse = nodeAdapter.transformResponse!;

    return async (config: ServerConfig = {}) => {
      const {
        isDev,
        port,
        defaultHeaders,
        globalMiddlewares,
        cluster: clusterConfig,
      } = config;

      // Configurer les agents HTTP pour optimiser les performances
      const agents = configureHttpAgent();

      if (cluster.isPrimary) {
        primaryLog("🚀 Performance optimizations enabled:");
        primaryLog(`   - Max sockets: ${agents.http.maxSockets}`);
        primaryLog(`   - Keep-alive: ${agents.http.keepAlive}`);
        primaryLog(`   - Max free sockets: ${agents.http.maxFreeSockets}`);
        primaryLog(`   - Socket timeout: ${agents.http.timeout}ms`);
        primaryLog(`   - TCP no delay: enabled`);
      }

      if (clusterConfig?.enabled && cluster.isPrimary) {
        const numWorkers = clusterConfig.workers || os.cpus().length;

        primaryLog(`🧵 Starting server with ${numWorkers} workers`);

        for (let i = 0; i < numWorkers; i++) {
          cluster.fork();
        }

        cluster.on("exit", (worker, code, signal) => {
          primaryLog(
            `Worker ${worker.process.pid} died with ${
              signal || code
            }. Restarting...`
          );
          setTimeout(() => {
            const newWorker = cluster.fork();
            primaryLog(
              `New worker ${newWorker.process.pid} started to replace ${worker.process.pid}`
            );
          }, 1000);
        });

        cluster.on("message", (worker, message) => {
          if (message.type === "ready") {
            primaryLog(`Worker ${worker.process.pid} is ready`);
          }
        });

        return { close: () => {} };
      }

      await loadRoutes(routesDir);

      if (isDev && cluster.isPrimary) {
        watchRoutes(routesDir);
      }

      const requestListener: http.RequestListener = async (req, res) => {
        req.setTimeout(30000); // 30 secondes

        if (req.headers.connection !== "close") {
          res.setHeader("Connection", "keep-alive");
          res.setHeader("Keep-Alive", "timeout=5, max=1000");
        }

        const enhancedReq = transformRequest(req);
        const enhancedRes = transformResponse(res);

        try {
          if (defaultHeaders) {
            Object.entries(defaultHeaders).forEach(([key, value]) => {
              res.setHeader(key, value);
            });
          }

          if (globalMiddlewares?.beforeRequest) {
            const result = await globalMiddlewares.beforeRequest(
              enhancedReq,
              enhancedRes
            );
            if (!result) return;
          }

          const shouldContinue = await runMiddlewares(
            "beforeRequest",
            enhancedReq,
            enhancedRes
          );
          if (!shouldContinue) return;

          const timeoutMiddleware = createTimeoutMiddleware(config);
          addMiddleware("beforeRequest", timeoutMiddleware);

          const route = findRoute(
            enhancedReq.url || "/",
            enhancedReq.method || "GET"
          );

          if (!route) {
            enhancedRes
              .status(404)
              .setHeader("Content-Type", "application/json")
              .json({ error: "Route not found" });
            return;
          }

          if ("error" in route) {
            const status = route.status || 500;
            enhancedRes
              .status(status)
              .setHeader("Content-Type", "application/json")
              .json({ error: route.error });
            return;
          }

          enhancedReq.params = route.params;
          await route.handler(enhancedReq, enhancedRes);

          if (globalMiddlewares?.afterRequest) {
            const result = await globalMiddlewares.afterRequest(
              enhancedReq,
              enhancedRes
            );
            if (!result) return;
          }

          await runMiddlewares("afterRequest", enhancedReq, enhancedRes);
        } catch (error) {
          console.error("Server error:", error);

          if (globalMiddlewares?.onError) {
            const result = await globalMiddlewares.onError(
              enhancedReq,
              enhancedRes,
              error
            );
            if (!result) return;
          }

          await runMiddlewares("onError", enhancedReq, enhancedRes, error);

          if (!res.headersSent) {
            enhancedRes.status(500).json({ error: "Internal Server Error" });
          }
        }
      };

      const serverOptions = {
        keepAliveTimeout: 120000,
        maxHeadersCount: 100,
        headersTimeout: 60000,
        requestTimeout: 300000,
      };

      const server = isDev
        ? http.createServer(
            {
              ...serverOptions,
              agent: agents.http,
            },
            requestListener
          )
        : https.createServer(
            {
              ...serverOptions,
              agent: agents.https,
            },
            requestListener
          );

      server.maxConnections = 10000;

      server.listen(
        port,
        () => {
          if (cluster.isPrimary) {
            primaryLog(
              `🚀 Server started on ${
                isDev ? "http" : "https"
              }://localhost:${port}${isDev ? " (dev)" : ""}`
            );
          }
        },
        511
      );

      if (cluster.isWorker && process.send) {
        process.send({ type: "ready" });
      }

      return server;
    };
  },
  transformRequest: (req) => enhanceRequest(req),
  transformResponse: (res) => enhanceResponse(res),
};
