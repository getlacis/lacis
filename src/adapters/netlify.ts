import type { Adapter, NetlifyContext, NetlifyEvent } from "@/types";
import type { Route, RouteHandlers } from "@/types";
import { IncomingMessage, ServerResponse } from "http";
import { findRoute } from "@core/router";

export const netlifyAdapter: Adapter = {
  name: "netlify",
  createHandler: (routesDir: string) => {
    return async (event: NetlifyEvent, context: NetlifyContext) => {
      const route = findRoute(event.path, event.httpMethod) as Route | null;
      const method = event.httpMethod as keyof RouteHandlers;

      if (!route) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: "Route not found" }),
        };
      }

      const handler = route.handlers[method];

      if (!handler) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: "Method not allowed" }),
        };
      }

      const req = {
        url: event.path,
        method: event.httpMethod,
        headers: event.headers,
        body: event.body ? JSON.parse(event.body) : undefined,
      } as unknown as IncomingMessage;

      let responseBody: any;
      let responseHeaders: Record<string, string> = {};
      let statusCode = 200;

      const res = {
        writeHead: (status: number, headers?: Record<string, string>) => {
          statusCode = status;
          if (headers) {
            responseHeaders = { ...responseHeaders, ...headers };
          }
          return res;
        },
        end: (body?: string) => {
          responseBody = body;
        },
      } as unknown as ServerResponse;

      try {
        await handler(req, res);

        return {
          statusCode,
          headers: responseHeaders,
          body: responseBody || "",
        };
      } catch (error) {
        console.error("Handler error:", error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Internal server error" }),
        };
      }
    };
  },
};
