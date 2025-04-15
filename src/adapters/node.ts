import http from "http";
import cluster from "cluster";
import os from "os";
import type { Adapter, ServerConfig } from "@/types";
import { loadRoutes, findRoute } from "@/core/router";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { runMiddlewares } from "@/core/middleware";
import { primaryLog } from "@/utils/logs";
import { getMonitor } from "@/utils/monitor";

const routeCache = new Map();
const MAX_ROUTE_CACHE = 1000;

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (routesDir: string) => {
    const transformRequest = nodeAdapter.transformRequest!;
    const transformResponse = nodeAdapter.transformResponse!;

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
            }). Restarting...`
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

        const requestListener = (
          req: http.IncomingMessage,
          res: http.ServerResponse
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

          const handleRequest = async () => {
            const enhancedReq = transformRequest(req);
            const enhancedRes = transformResponse(res);

            try {
              if (
                isDev &&
                performanceMonitor &&
                enhancedReq.url === "/health"
              ) {
                enhancedRes.setHeader("Content-Type", "application/json");
                enhancedRes.end(
                  JSON.stringify(performanceMonitor.getHealthMetrics())
                );
                requestTracker?.end(200);
                return;
              }

              const cacheKey = `${enhancedReq.method}:${enhancedReq.url}`;
              let route = routeCache.get(cacheKey);

              if (!route) {
                route = findRoute(
                  enhancedReq.url || "/",
                  enhancedReq.method || "GET"
                );

                if (route) {
                  routeCache.set(cacheKey, route);

                  if (routeCache.size > MAX_ROUTE_CACHE) {
                    const keysToDelete = Array.from(routeCache.keys()).slice(
                      0,
                      100
                    );
                    for (const key of keysToDelete) {
                      routeCache.delete(key);
                    }
                  }
                }
              }

              if (!route) {
                await runMiddlewares("onError", enhancedReq, enhancedRes);
                enhancedRes.status(404).json({ error: "Route not found" });
                requestTracker?.end(404);
                return;
              }

              if ("error" in route) {
                const status = route.status || 500;
                enhancedRes.status(status).json({ error: route.error });
                requestTracker?.end(status, true);
                return;
              }

              const middlewaresResult = await runMiddlewares(
                "beforeRequest",
                enhancedReq,
                enhancedRes
              );
              if (middlewaresResult === false || enhancedRes.headersSent) {
                requestTracker?.end(enhancedRes.statusCode || 400);
                return;
              }

              enhancedReq.params = route.params;

              await route.handler(enhancedReq, enhancedRes);
              await runMiddlewares("afterRequest", enhancedReq, enhancedRes);

              if (!enhancedRes.headersSent) {
                enhancedRes.end();
              }

              requestTracker?.end(enhancedRes.statusCode || 200);
            } catch (error) {
              if (isDev) {
                console.error("Error:", error);
              }

              if (!enhancedRes.headersSent) {
                enhancedRes
                  .status(500)
                  .json({ error: "Internal Server Error" });
              }

              await runMiddlewares("onError", enhancedReq, enhancedRes);
              requestTracker?.end(enhancedRes.statusCode || 500, true);
            }
          };

          handleRequest().catch((err) => {
            if (isDev) {
              console.error("Fatal error:", err);
            }
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Server Error");
            }

            requestTracker?.end(500, true);
          });
        };

        const server = http.createServer(requestListener);

        server.listen(port, () => {
          if (cluster.isPrimary || !clusterConfig?.enabled) {
            primaryLog(
              `🚀 Server running at http://localhost:${port}/` +
                (isDev ? " (dev)" : "")
            );
            if (isDev && performanceMonitor) {
              primaryLog(
                `📊 Performance monitoring available at http://localhost:${port}/health`
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
  transformRequest: (req) => enhanceRequest(req),
  transformResponse: (res) => enhanceResponse(res),
};
