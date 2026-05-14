import {
  hasMiddlewares,
  registerMiddlewareConfig,
  runMiddlewares,
} from "@/core/middleware";
import { findRoute, loadRoutes } from "@/core/router";
import type { Adapter, ServerConfig, ServerlessConfig } from "@/types";
import {
  nodeBody,
  withRequestMethods,
  withResponseMethods,
} from "@/utils/adapter-base";
import { primaryLog } from "@/utils/logs";
import { getMonitor } from "@/utils/monitor";
import cluster from "cluster";
import http from "http";
import https from "https";
import os from "os";

class _ZenoRequestBase extends http.IncomingMessage {
  params: Record<string, string> = {};
  body = nodeBody;
}

class ZenoRequest extends withRequestMethods(_ZenoRequestBase) {}

class ZenoResponse extends withResponseMethods(
  http.ServerResponse<ZenoRequest>,
) {}

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config !== "string") {
      throw new Error(
        "nodeAdapter requires a routesDir string, not a ServerlessConfig.",
      );
    }

    const routesDir = config;

    return async (config: ServerConfig = {}) => {
      const {
        port = 3000,
        defaultHeaders,
        isDev,
        cluster: clusterConfig,
        monitoring = { enabled: false },
      } = config;

      let performanceMonitor = null;
      if (isDev && monitoring.enabled) {
        performanceMonitor = getMonitor({
          sampleInterval: monitoring.sampleInterval || 5000,
          reportInterval: monitoring.reportInterval || 60000,
          thresholds: monitoring.thresholds,
          logToConsole: true,
        });

        if (cluster.isPrimary) {
          primaryLog("📊 Development performance monitoring enabled");
          performanceMonitor.on("alarm", (metricType, message) => {
            primaryLog(`⚠️ ALERT: ${message}`);
          });
          performanceMonitor.on("alarm-clear", (metricType, message) => {
            primaryLog(`✅ RESOLVED: ${message}`);
          });
        }
      }

      const defaultHeadersArr = defaultHeaders
        ? Object.entries(defaultHeaders)
        : [];

      // Primary process for cluster management
      if (clusterConfig?.enabled && cluster.isPrimary) {
        const numWorkers = clusterConfig.workers || os.cpus().length;

        primaryLog(`🧵 Starting server with ${numWorkers} workers`);

        // Force Round Robin scheduling when available
        if (cluster.schedulingPolicy !== undefined) {
          try {
            cluster.schedulingPolicy = cluster.SCHED_RR;
            primaryLog(`📋 Using Round Robin scheduling policy`);
          } catch (e) {
            primaryLog(`⚠️ Could not set Round Robin scheduling policy`);
          }
        }

        for (let i = 0; i < numWorkers; i++) {
          cluster.fork();
        }

        cluster.on("exit", (worker, code, signal) => {
          primaryLog(
            `Worker ${worker.process.pid} died (${
              signal || code
            }). Restarting...`,
          );
          setTimeout(() => {
            cluster.fork();
          }, 1000);
        });

        return {
          close: () => {
            for (const id in cluster.workers) {
              cluster.workers[id]?.kill();
            }
            if (performanceMonitor) {
              performanceMonitor.stop();
            }
          },
        };
      }

      if (cluster.isWorker || !clusterConfig?.enabled) {
        await loadRoutes(routesDir);
        registerMiddlewareConfig(config.middleware);

        const handleRequest = async (
          req: ZenoRequest,
          res: ZenoResponse,
          requestTracker: any,
        ) => {
          try {
            if (isDev && performanceMonitor && req.url === "/health") {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(performanceMonitor.getHealthMetrics()));
              requestTracker?.end(200);
              return;
            }

            const rawUrl = req.url || "/";
            const qIdx = rawUrl.indexOf("?");
            const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
            const route = findRoute(pathname, req.method || "GET");

            if (!route) {
              if (hasMiddlewares())
                await runMiddlewares("onError", req as any, res as any);
              res.status(404).json({ error: "Route not found" });
              requestTracker?.end(404);
              return;
            }

            if ("error" in route) {
              const status = route.status || 500;
              res.status(status).json({ error: route.error });
              requestTracker?.end(status, true);
              return;
            }

            if (hasMiddlewares()) {
              const ok = await runMiddlewares(
                "beforeRequest",
                req as any,
                res as any,
              );
              if (ok === false || res.headersSent) {
                requestTracker?.end(res.statusCode || 400);
                return;
              }
            }

            req.params = route.params;
            await route.handler(req as any, res as any);

            if (hasMiddlewares()) {
              await runMiddlewares("afterRequest", req as any, res as any);
            }

            if (!res.headersSent) res.end();
            requestTracker?.end(res.statusCode || 200);
          } catch (error) {
            if (isDev) console.error("Error:", error);
            if (!res.headersSent)
              res.status(500).json({ error: "Internal Server Error" });
            if (hasMiddlewares())
              await runMiddlewares("onError", req as any, res as any);
            requestTracker?.end(res.statusCode || 500, true);
          }
        };

        const requestListener = (
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ) => {
          const requestTracker =
            isDev && performanceMonitor
              ? performanceMonitor.trackRequest()
              : null;

          if (defaultHeadersArr.length > 0) {
            for (let i = 0; i < defaultHeadersArr.length; i++) {
              res.setHeader(defaultHeadersArr[i][0], defaultHeadersArr[i][1]);
            }
          }

          handleRequest(
            req as unknown as ZenoRequest,
            res as unknown as ZenoResponse,
            requestTracker,
          ).catch((err) => {
            if (isDev) console.error("Fatal error:", err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Server Error");
            }
            requestTracker?.end(500, true);
          });
        };

        // http.createServer accepts custom IncomingMessage/ServerResponse subclasses so Node instantiates our versions per request
        const serverOptions = {
          IncomingMessage: ZenoRequest,
          ServerResponse: ZenoResponse,
        } as any;
        const server = config.httpsOptions
          ? https.createServer(
              { ...serverOptions, ...config.httpsOptions },
              requestListener as any,
            )
          : http.createServer(serverOptions, requestListener);

        const protocol = config.httpsOptions ? "https" : "http";

        server.listen(port, () => {
          if (cluster.isPrimary || !clusterConfig?.enabled) {
            primaryLog(
              `🚀 Server running at ${protocol}://localhost:${port}/` +
                (isDev ? " (dev)" : ""),
            );
            if (isDev && performanceMonitor) {
              primaryLog(
                `📊 Performance monitoring available at http://localhost:${port}/health`,
              );
            }
          } else if (isDev) {
            primaryLog(`Worker ${process.pid} is listening on port ${port}`);
          }
        });

        return server;
      }

      return null;
    };
  },
};
