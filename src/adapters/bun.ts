import {
  hasMiddlewares,
  registerMiddlewareConfig,
  runMiddlewares,
} from "@/core/middleware";
import { findRoute, loadRoutes } from "@/core/router";
import type { Adapter, ServerConfig, ServerlessConfig } from "@/types";
import {
  withRequestMethods,
  withResponseMethods,
  type ZenoHeaders,
} from "@/utils/adapter-base";
import { primaryLog } from "@/utils/logs";

const MAX_BODY_SIZE = 10_485_760;

class _BunRequestBase {
  params: Record<string, string> = {};
  url: string;
  method: string;
  headers: ZenoHeaders;
  socket = { setTimeout: (_: number) => {} } as const;
  connection: { remoteAddress: string };
  private _req: Request;

  constructor(req: Request, pathname: string, search: string) {
    this._req = req;
    this.url = pathname + search;
    this.method = req.method;
    this.headers = req.headers as unknown as ZenoHeaders;
    this.connection = {
      remoteAddress: req.headers.get("x-forwarded-for") ?? "127.0.0.1",
    };
  }

  setTimeout(_: number) {}

  text() {
    return this._req.text();
  }
  body() {
    return this._req.arrayBuffer().then((b: ArrayBuffer) => {
      if (b.byteLength > MAX_BODY_SIZE)
        throw Object.assign(new Error("Payload Too Large"), { code: 413 });
      return Buffer.from(b);
    });
  }
}

class BunRequest extends withRequestMethods(_BunRequestBase) {
  // Uses Bun native JSON parser directly, skipping the body() to Buffer conversion
  json<T = any>(): Promise<T> {
    return (this as any)._req.json() as Promise<T>;
  }
}

class _BunResponseBase {
  statusCode = 200;
  headersSent = false;
  get finished() {
    return this.headersSent;
  }
  get writableEnded() {
    return this.headersSent;
  }

  _body: any = null;
  _headers: string[] | null = null;
  private _listeners: ((...a: any[]) => void)[] | null = null;

  on(event: string, listener: (...a: any[]) => void) {
    if (event === "finish" || event === "close") {
      if (!this._listeners) this._listeners = [];
      this._listeners.push(listener);
    }
    return this;
  }
  once(event: string, listener: (...a: any[]) => void) {
    return this.on(event, listener);
  }
  emit(event: string) {
    if ((event === "finish" || event === "close") && this._listeners)
      for (let i = 0; i < this._listeners.length; i++) this._listeners[i]();
    return true;
  }

  setHeader(name: string, value: string) {
    if (!this._headers) this._headers = [];
    this._headers.push(name, value);
    return this;
  }
  getHeader(name: string) {
    if (!this._headers) return undefined;
    const lo = name.toLowerCase();
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) return this._headers[i + 1];
  }
  removeHeader(name: string) {
    if (!this._headers) return this;
    const lo = name.toLowerCase();
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) {
        this._headers.splice(i, 2);
        break;
      }
    return this;
  }
  hasHeader(name: string) {
    if (!this._headers) return false;
    const lo = name.toLowerCase();
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) return true;
    return false;
  }
  writeHead(statusCode: number, headers?: Record<string, string> | null) {
    this.statusCode = statusCode;
    if (headers)
      for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    return this;
  }
  write(chunk: any) {
    this._body = (this._body ?? "") + chunk;
    return true;
  }
  end(data?: any) {
    if (data !== undefined) this.write(data);
    this.headersSent = true;
    if (this._listeners)
      for (let i = 0; i < this._listeners.length; i++) this._listeners[i]();
    return this;
  }
}

class BunResponse extends withResponseMethods(_BunResponseBase) {}

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
      const { isDev, port = 3000, defaultHeaders } = config;

      primaryLog("🚀 Bun high-performance mode enabled");

      await loadRoutes(routesDir);
      registerMiddlewareConfig(config.middleware);

      const defaultHeadersEntries = defaultHeaders
        ? Object.entries(defaultHeaders)
        : [];

      const server = Bun.serve({
        port,
        async fetch(request) {
          const url = new URL(request.url);
          const pathname = url.pathname;

          const req = new BunRequest(request, pathname, url.search);
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
              if (!ok || res.headersSent) return buildResponse(res);
            }

            const route = findRoute(pathname, request.method);

            if (!route) {
              if (hasMiddlewares())
                await runMiddlewares("onError", req as any, res as any);
              return new Response(
                JSON.stringify({ error: "Route not found" }),
                {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            if ("error" in route) {
              if (hasMiddlewares())
                await runMiddlewares("onError", req as any, res as any);
              return new Response(JSON.stringify({ error: route.error }), {
                status: route.status || 500,
                headers: { "Content-Type": "application/json" },
              });
            }

            req.params = route.params;
            await route.handler(req as any, res as any);

            if (hasMiddlewares())
              await runMiddlewares("afterRequest", req as any, res as any);
            if (!res.headersSent) res.end();

            return buildResponse(res);
          } catch (error) {
            if (isDev) console.error("Server error:", error);
            return new Response(
              JSON.stringify({ error: "Internal Server Error" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
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

function buildResponse(res: _BunResponseBase): Response {
  if (!res._headers) return new Response(res._body, { status: res.statusCode });
  const headers = new Headers();
  for (let i = 0; i < res._headers.length; i += 2)
    headers.set(res._headers[i], res._headers[i + 1]);
  return new Response(res._body, { status: res.statusCode, headers });
}
