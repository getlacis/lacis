import type { Adapter, NetlifyContext, NetlifyEvent } from "@/types";
import { findRoute, isRouteError } from "@/core/router";
import { IncomingMessage, ServerResponse } from "http";

export const netlifyAdapter: Adapter = {
  name: "netlify",
  createHandler: (_routesDir: string) => {
    return async (event: NetlifyEvent, _context: NetlifyContext) => {
      const route = findRoute(event.path, event.httpMethod);

      if (!route) {
        return { statusCode: 404, body: JSON.stringify({ error: "Route not found" }) };
      }

      if (isRouteError(route)) {
        return {
          statusCode: route.status || 500,
          body: JSON.stringify({ error: route.error }),
        };
      }

      const req = {
        url: event.path,
        method: event.httpMethod,
        headers: event.headers,
        params: route.params,
        body: event.body ? JSON.parse(event.body) : undefined,
      } as unknown as IncomingMessage;

      let responseBody: any;
      let responseHeaders: Record<string, string> = {};
      let statusCode = 200;

      const res = {
        writeHead: (status: number, headers?: Record<string, string>) => {
          statusCode = status;
          if (headers) responseHeaders = { ...responseHeaders, ...headers };
          return res;
        },
        setHeader: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
        end: (body?: string) => {
          responseBody = body;
        },
      } as unknown as ServerResponse;

      try {
        await route.handler(req, res);
        return { statusCode, headers: responseHeaders, body: responseBody || "" };
      } catch (error) {
        console.error("Handler error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
      }
    };
  },
};
