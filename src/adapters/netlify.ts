import type { Adapter, ServerlessConfig, NetlifyEvent, NetlifyContext, Request, Response } from "@/types";
import { findRoute, isRouteError, registerRoutes } from "@/core/router";
import { runMiddlewares, registerMiddlewareConfig, hasMiddlewares } from "@/core/middleware";
import { applyRequestMethods, applyResponseMethods } from "@/utils/adapter-base";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

export const netlifyAdapter: Adapter = {
  name: "netlify",
  createHandler: (config: string | ServerlessConfig) => {
    if (typeof config === "string") {
      throw new Error(
        "netlifyAdapter.createHandler() requires a ServerlessConfig object. " +
        "Run `zeno build` to generate routes/_manifest.ts and pass { routes } instead."
      );
    }

    let initPromise: Promise<void> | null = null;

    const init = (): Promise<void> => {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        registerRoutes(config.routes);
        registerMiddlewareConfig(config.middleware);
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
        rawReq.push(Buffer.from(event.body, "utf-8"));
      }
      rawReq.push(null);

      let responseBody = "";
      let responseHeaders: Record<string, string> = {};
      let statusCode = 200;
      let headersSent = false;

      const rawRes = new ServerResponse(rawReq);

      rawRes.writeHead = function (status: number, headers?: any) {
        statusCode = status;
        if (headers) responseHeaders = { ...responseHeaders, ...headers };
        return this;
      };
      rawRes.setHeader = function (name: string, value: any) {
        responseHeaders[name.toLowerCase()] = String(value);
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

      // Single cast: IncomingMessage/ServerResponse don't know about the zeno methods we just applied
      const req = rawReq as unknown as Request;
      const res = rawRes as unknown as Response;

      const route = findRoute(event.path, event.httpMethod);

      if (!route) {
        return { statusCode: 404, body: JSON.stringify({ error: "Route not found" }) };
      }

      if (isRouteError(route)) {
        return {
          statusCode: route.status ?? 500,
          body: JSON.stringify({ error: route.error }),
        };
      }

      req.params = route.params;

      try {
        if (hasMiddlewares()) {
          const shouldContinue = await runMiddlewares("beforeRequest", req, res);
          if (shouldContinue === false || headersSent) {
            return { statusCode: res.statusCode ?? statusCode, headers: responseHeaders, body: responseBody };
          }
        }

        await route.handler(req, res);

        if (hasMiddlewares()) await runMiddlewares("afterRequest", req, res);

        return { statusCode: res.statusCode ?? statusCode, headers: responseHeaders, body: responseBody };
      } catch (error) {
        console.error("[zeno/netlify] Handler error:", error);
        if (hasMiddlewares()) await runMiddlewares("onError", req, res, { error });
        if (!headersSent) {
          return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
        }
        return { statusCode: res.statusCode ?? 500, headers: responseHeaders, body: responseBody };
      }
    };
  },
};
