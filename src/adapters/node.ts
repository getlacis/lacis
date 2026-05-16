import {
  hasMiddlewares,
  registerMiddlewareConfig,
  runMiddlewares,
} from "@/core/middleware";
import { registerCorsConfig } from "@/core/cors";
import { findRoute, loadRoutes } from "@/core/router";
import type { Adapter, ServerConfig, ServerlessConfig } from "@/types";
import {
  extractPathname,
  handleAdapterError,
  nodeBody,
  parseQueryString,
  withRequestMethods,
  withResponseMethods,
} from "@/utils/adapter-base";
import { primaryLog } from "@/utils/logs";
import { getMonitor } from "@/utils/monitor";
import { createLoadBalancer } from "@/utils/loadBalancer";
import cluster from "cluster";
import http from "http";
import https from "https";
import os from "os";

class _LacisRequestBase extends http.IncomingMessage {
  params: Record<string, string> = {};
  body = nodeBody;
}

class LacisRequest extends withRequestMethods(_LacisRequestBase) {}

class LacisResponse extends withResponseMethods(
  http.ServerResponse<LacisRequest>,
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

      if (clusterConfig?.enabled && cluster.isPrimary) {
        const numWorkers = clusterConfig.workers ?? os.cpus().length;
        const protocol = config.httpsOptions ? 'https' : 'http';

        primaryLog(`🧵 Starting server with ${numWorkers} workers`);

        // SCHED_RR must be set before the first cluster.fork() — frozen after that
        if (cluster.schedulingPolicy !== undefined) {
          try { cluster.schedulingPolicy = cluster.SCHED_RR; } catch {}
        }

        const lb = createLoadBalancer();
        lb.start(numWorkers);

        primaryLog(`🚀 Server running at ${protocol}://localhost:${port}/` + (isDev ? ' (dev)' : ''));
        if (isDev && performanceMonitor) {
          primaryLog(`📊 Performance monitoring available at http://localhost:${port}/health`);
        }

        return {
          close: (callback?: () => void) => {
            if (performanceMonitor) performanceMonitor.stop();
            lb.shutdown(callback);
          },
        };
      }

      if (cluster.isWorker || !clusterConfig?.enabled) {
        await loadRoutes(routesDir);
        registerCorsConfig(config.cors);
        registerMiddlewareConfig(config.middleware);

        const handleRequest = async (
          req: LacisRequest,
          res: LacisResponse,
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
            const pathname = extractPathname(rawUrl);
            (req as any).query = parseQueryString(rawUrl);

            if (hasMiddlewares()) {
              const ok = await runMiddlewares(
                "beforeRequest",
                req as any,
                res as any,
              );
              if (ok === false || res.headersSent) {
                requestTracker?.end(res.statusCode || 204);
                return;
              }
            }

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

            req.params = route.params;
            await route.handler(req as any, res as any);

            if (hasMiddlewares()) {
              await runMiddlewares("afterRequest", req as any, res as any);
            }

            if (!res.headersSent) res.end();
            requestTracker?.end(res.statusCode || 200);
          } catch (error) {
            await handleAdapterError(req as any, res as any, error);
            if (!res.headersSent)
              res.status(500).json({ error: "Internal Server Error" });
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
            req as unknown as LacisRequest,
            res as unknown as LacisResponse,
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
          IncomingMessage: LacisRequest,
          ServerResponse: LacisResponse,
        } as any;
        const server = config.httpsOptions
          ? https.createServer(
              { ...serverOptions, ...config.httpsOptions },
              requestListener as any,
            )
          : http.createServer(serverOptions, requestListener);

        server.on('clientError', (_err: any, socket: any) => {
          if (!socket.destroyed) socket.destroy();
        });

        const protocol = config.httpsOptions ? "https" : "http";

        if (cluster.isWorker) {
          createLoadBalancer().start();
        }

        server.listen(port, () => {
          if (!clusterConfig?.enabled) {
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
