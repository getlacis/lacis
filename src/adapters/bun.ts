import {
  hasMiddlewares,
  registerMiddlewareConfig,
  runMiddlewares,
} from "@/core/middleware";
import { registerCorsConfig } from "@/core/cors";
import { findRoute, loadRoutes } from "@/core/router";
import type { Adapter, ServerConfig, ServerlessConfig, SSEOptions } from "@/types";
import {
  withRequestMethods,
  withResponseMethods,
  type ZenoHeaders,
} from "@/utils/adapter-base";
import { primaryLog } from "@/utils/logs";

const MAX_BODY_SIZE = 10_485_760;
const _encoder = new TextEncoder();

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
  _sseReadable: ReadableStream<Uint8Array> | null = null;
  private _sseWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _sseWindowClosed = false;
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

  setHeader(name: string, value: string | string[]) {
    if (!this._headers) this._headers = [];
    if (Array.isArray(value)) {
      for (const v of value) this._headers.push(name, v);
    } else {
      this._headers.push(name, value);
    }
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
    if (this._sseWriter) {
      this._sseWriter.write(_encoder.encode(String(chunk)));
      return true;
    }
    this._body = (this._body ?? "") + chunk;
    return true;
  }
  end(data?: any) {
    if (data !== undefined) this.write(data);
    if (this._sseWriter) this._sseWriter.close();
    this.headersSent = true;
    if (this._listeners)
      for (let i = 0; i < this._listeners.length; i++) this._listeners[i]();
    return this;
  }

  _initSseStream() {
    if (this._sseWindowClosed)
      throw new Error("[zeno/bun] initSSE() must be called synchronously before any `await` in your handler.");
    const { readable, writable } = new TransformStream<Uint8Array>();
    this._sseReadable = readable;
    this._sseWriter = writable.getWriter();
  }

  _closeSseWindow() {
    this._sseWindowClosed = true;
  }
}

class BunResponse extends withResponseMethods(_BunResponseBase) {
  // Override initSSE to set up a TransformStream before calling writeHead
  initSSE(options?: SSEOptions) {
    this._initSseStream();
    return super.initSSE(options);
  }
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
      const { isDev, port = 3000, defaultHeaders } = config;

      primaryLog("🚀 Bun high-performance mode enabled");

      await loadRoutes(routesDir);
      registerCorsConfig(config.cors);
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

            // One microtask: enough for synchronous initSSE() at the top of the handler to run.
            // After this point, calling initSSE() will throw an explicit error.
            await Promise.resolve();
            res._closeSseWindow();

            if (res._sseReadable) {
              // SSE: return the streaming response immediately; handler runs in background
              return buildResponse(res, res._sseReadable);
            }

            // Regular request: wait for the handler to complete
            await handlerDone;

            if (handlerError && !res.headersSent) {
              return new Response(
                JSON.stringify({ error: "Internal Server Error" }),
                {
                  status: 500,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }

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

function buildResponse(res: _BunResponseBase, body?: ReadableStream<Uint8Array> | null): Response {
  const responseBody = body ?? res._body;
  if (!res._headers) return new Response(responseBody, { status: res.statusCode });
  const headers = new Headers();
  for (let i = 0; i < res._headers.length; i += 2) {
    const name = res._headers[i];
    const value = res._headers[i + 1];
    if (name.toLowerCase() === 'set-cookie') {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(responseBody, { status: res.statusCode, headers });
}
