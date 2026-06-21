import {
  hasMiddlewares,
  hasNotFoundHook,
  registerHooksConfig,
  registerMiddlewareConfig,
  runMiddlewares,
  runNotFoundHook,
} from "@/core/middleware";
import { registerCorsConfig } from "@/core/cors";
import { findRoute, isRouteError, loadRoutes } from "@/core/router";
import type { Adapter, ServerConfig, ServerlessConfig } from "@/types";
import {
  handleAdapterError,
  parseQueryString,
  withRequestMethods,
} from "@/utils/adapter-base";
import { WebApiResponse, WebApiRequestBase, buildWebApiResponse } from "@/utils/web-adapter-base";
import { primaryLog } from "@/utils/logs";
import os from "os";

class _BunRequestBase extends WebApiRequestBase {
  // Bun-specific: expose the native text() reader. body()/json() come from the
  // shared base (json() uses Bun's native parser via the underlying Request).
  text() {
    return this._req.text();
  }
}

class BunRequest extends withRequestMethods(_BunRequestBase) {}

class BunResponse extends WebApiResponse {
  protected _adapterName = 'bun'
}

export const bunAdapter: Adapter = {
  name: "bun",
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config !== "string") {
      throw new Error(
        "bunAdapter requires a routesDir string, not a ServerlessConfig.",
      );
    }
    const routesDir = config;

    return async (config: ServerConfig = {}) => {
      const { isDev, port = 3000, defaultHeaders, cluster: clusterConfig } = config;

      // LACIS_BUN_WORKER contains the primary's PID so workers can detect parent death
      const primaryPid = parseInt(process.env.LACIS_BUN_WORKER ?? '0');
      const isWorker = primaryPid > 0;

      if (clusterConfig?.enabled && !isWorker) {
        const numWorkers = clusterConfig.workers ?? os.cpus().length;
        primaryLog(`🧵 Starting Bun server with ${numWorkers} workers (reusePort)`);

        const procs = Array.from({ length: numWorkers }, () =>
          Bun.spawn(process.argv, {
            env: { ...process.env as Record<string, string>, LACIS_BUN_WORKER: String(process.pid) },
            stdout: 'ignore',
            stderr: 'inherit',
          })
        );

        primaryLog(`🚀 Server running at http://localhost:${port}/`);

        return {
          close: (callback?: () => void) => {
            for (const p of procs) p.kill();
            callback?.();
          },
        };
      }

      // Worker: periodically check the primary is still alive to avoid orphan processes
      if (isWorker) {
        const interval = setInterval(() => {
          try { process.kill(primaryPid, 0); }
          catch { clearInterval(interval); process.exit(0); }
        }, 2000);
        interval.unref();
      }

      primaryLog("🚀 Bun high-performance mode enabled");

      if (!config.routes) await loadRoutes(routesDir);
      registerCorsConfig(config.cors);
      registerMiddlewareConfig(config.middleware);
      registerHooksConfig(config.hooks);

      const defaultHeadersEntries = defaultHeaders
        ? Object.entries(defaultHeaders)
        : [];

      const server = Bun.serve({
        port,
        reusePort: isWorker,
        async fetch(request, server) {
          const url = new URL(request.url);
          const pathname = url.pathname;

          const req = new BunRequest(request, pathname + url.search, server?.requestIP(request)?.address ?? "");
          req._maxBodySize = config.maxBodySize;
          (req as any).query = parseQueryString(url.search);
          const res = new BunResponse();

          try {
            for (let i = 0; i < defaultHeadersEntries.length; i++) {
              res.setHeader(
                defaultHeadersEntries[i][0],
                defaultHeadersEntries[i][1],
              );
            }

            if (hasMiddlewares()) {
              const ok = await runMiddlewares(
                "beforeRequest",
                req as any,
                res as any,
              );
              if (!ok || res.headersSent) return buildWebApiResponse(res);
            }

            const route = findRoute(pathname, request.method);

            if (!route) {
              if (hasNotFoundHook()) {
                await runNotFoundHook(req as any, res as any);
                if (res.headersSent) return buildWebApiResponse(res);
              }
              return new Response(
                JSON.stringify({ error: "Route not found" }),
                {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            if (isRouteError(route)) {
              if (hasMiddlewares())
                await runMiddlewares("onError", req as any, res as any);
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (route.allowedMethods?.length) headers["Allow"] = route.allowedMethods.join(", ");
              return new Response(JSON.stringify({ error: route.error }), {
                status: route.status || 500,
                headers,
              });
            }

            req.params = route.params;

            // Start the handler without awaiting so SSE handlers can run in the background.
            // The IIFE captures any error for later inspection in the non-SSE path.
            let handlerError: unknown = null;
            const handlerDone = (async () => {
              await route.handler(req as any, res as any);
              if (hasMiddlewares())
                await runMiddlewares("afterRequest", req as any, res as any);
              if (!res.headersSent) res.end();
            })().catch((err) => {
              handlerError = err;
              if (isDev) console.error("Server error:", err);
              // Only close an open SSE stream — non-SSE errors are handled below via handlerError
              if (res._sseReadable && !res.headersSent) res.end();
            });

            // The handler's sync portion has already run (up to its first await),
            // so initSSE() has been called if it's going to be. Close the window now.
            res._closeSseWindow();

            if (res._sseReadable) {
              // SSE: return the streaming response immediately; handler runs in background
              return buildWebApiResponse(res, res._sseReadable);
            }

            // Regular request: wait for the handler to complete
            await handlerDone;

            if (handlerError) {
              await handleAdapterError(req as any, res as any, handlerError);
              if (!res.headersSent) {
                return new Response(
                  JSON.stringify({ error: "Internal Server Error" }),
                  { status: 500, headers: { "Content-Type": "application/json" } },
                );
              }
            }

            return buildWebApiResponse(res);
          } catch (error) {
            await handleAdapterError(req as any, res as any, error);
            if (!res.headersSent) {
              return new Response(
                JSON.stringify({ error: "Internal Server Error" }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }
            return buildWebApiResponse(res);
          }
        },
      });

      primaryLog(
        `🚀 Server started on http://localhost:${port}${isDev ? " (dev)" : ""}`,
      );
      return {
        close: () => {
          server.stop();
        },
      };
    };
  },
};
