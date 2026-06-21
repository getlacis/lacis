import type { Adapter, ServerlessConfig, NetlifyEvent, NetlifyContext, Request, Response } from "@/types";
import { findRoute, isRouteError, registerRoutes } from "@/core/router";
import { runMiddlewares, registerMiddlewareConfig, registerMiddlewares, hasMiddlewares, registerHooksConfig, hasNotFoundHook, runNotFoundHook } from "@/core/middleware";
import { registerCorsConfig } from "@/core/cors";
import { applyRequestMethods, applyResponseMethods, handleAdapterError } from "@/utils/adapter-base";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

function netlifyResponse(
  statusCode: number,
  headers: Record<string, string>,
  multiValueHeaders: Record<string, string[]>,
  body: string,
) {
  const hasMulti = Object.keys(multiValueHeaders).length > 0;
  return { statusCode, headers, ...(hasMulti ? { multiValueHeaders } : {}), body };
}

export const netlifyAdapter: Adapter = {
  name: "netlify",
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config === "string") {
      throw new Error(
        "netlifyAdapter.createHandler() requires a ServerlessConfig object. " +
        "Run `lacis build` to generate routes/_manifest.ts and pass { routes } instead."
      );
    }

    let initPromise: Promise<void> | null = null;

    const init = (): Promise<void> => {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        registerRoutes(config.routes);
        registerCorsConfig(config.cors);
        registerMiddlewareConfig(config.middleware);
        registerMiddlewares(config.middlewares);
        registerHooksConfig(config.hooks);
      })();
      return initPromise;
    };

    return async (event: NetlifyEvent, _context: NetlifyContext) => {
      await init();

      const qs = event.queryStringParameters
        ? "?" + new URLSearchParams(event.queryStringParameters as Record<string, string>).toString()
        : "";
      const url = event.path + qs;

      const rawReq = new IncomingMessage(new Socket());
      rawReq.url = url;
      rawReq.method = event.httpMethod;
      (rawReq as any).headers = event.headers;

      if (event.body) {
        const encoding = event.isBase64Encoded ? "base64" : "utf-8";
        rawReq.push(Buffer.from(event.body, encoding));
      }
      rawReq.push(null);

      let responseBody = "";
      let responseHeaders: Record<string, string> = {};
      let multiValueResponseHeaders: Record<string, string[]> = {};
      let headersSent = false;

      const rawRes = new ServerResponse(rawReq);

      rawRes.writeHead = function (status: number, headers?: any) {
        rawRes.statusCode = status;
        if (headers) responseHeaders = { ...responseHeaders, ...headers };
        return this;
      };
      rawRes.setHeader = function (name: string, value: any) {
        const key = name.toLowerCase();
        if (Array.isArray(value)) {
          multiValueResponseHeaders[key] = value.map(String);
          responseHeaders[key] = String(value[0]);
        } else {
          responseHeaders[key] = String(value);
        }
        return this;
      };
      rawRes.getHeader = function (name: string) {
        return responseHeaders[name.toLowerCase()];
      };
      rawRes.end = function (body?: any) {
        headersSent = true;
        if (body !== undefined) responseBody = typeof body === "string" ? body : body.toString();
        return this;
      };
      Object.defineProperty(rawRes, "headersSent", { get: () => headersSent });

      applyRequestMethods(rawReq);
      applyResponseMethods(rawRes);
      (rawReq as any)._maxBodySize = config.maxBodySize;

      // Single cast: IncomingMessage/ServerResponse don't know about the lacis methods we just applied
      const req = rawReq as unknown as Request;
      const res = rawRes as unknown as Response;

      (req as any).query = event.queryStringParameters ?? {};

      try {
        if (hasMiddlewares()) {
          const shouldContinue = await runMiddlewares("beforeRequest", req, res);
          if (shouldContinue === false || headersSent) {
            return netlifyResponse(res.statusCode, responseHeaders, multiValueResponseHeaders, responseBody);
          }
        }

        const route = findRoute(event.path, event.httpMethod);

        if (!route) {
          if (hasNotFoundHook()) {
            await runNotFoundHook(req, res);
            if (headersSent) return netlifyResponse(res.statusCode, responseHeaders, multiValueResponseHeaders, responseBody);
          }
          return { statusCode: 404, body: JSON.stringify({ error: "Route not found" }) };
        }

        if (isRouteError(route)) {
          return {
            statusCode: route.status ?? 500,
            body: JSON.stringify({ error: route.error }),
          };
        }

        req.params = route.params;

        await route.handler(req, res);

        if (hasMiddlewares()) await runMiddlewares("afterRequest", req, res);

        return netlifyResponse(res.statusCode, responseHeaders, multiValueResponseHeaders, responseBody);
      } catch (error) {
        await handleAdapterError(req, res, error);
        if (!headersSent) {
          return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
        }
        return netlifyResponse(res.statusCode, responseHeaders, multiValueResponseHeaders, responseBody);
      }
    };
  },
};
