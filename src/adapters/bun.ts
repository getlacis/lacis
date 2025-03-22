import type { Adapter, ServerConfig } from "@/types";
import { type Server } from "bun";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { runMiddlewares } from "@/core/middleware";
import { primaryLog } from "@/utils/logs";
import { EventEmitter } from "events";

/**
 * No clustering because it currently degrades performance in Bun.
 * and a larger route cache (2000 entries) and optimized eviction (10%) for higher hit ratio in Bun, already try with Node, it doesn't improve it.
*/

const routeCache = new Map<string, any>();
const MAX_ROUTE_CACHE = 2000;

export const bunAdapter: Adapter = {
  name: "bun",
  createHandler: (routesDir: string) => {
    const transformRequest = bunAdapter.transformRequest!;
    const transformResponse = bunAdapter.transformResponse!;

    return async (config: ServerConfig = {}) => {
      const { 
        isDev, 
        port = 3000, 
        defaultHeaders
      } = config;
      
      primaryLog("🚀 Bun high-performance mode enabled");
      
      await loadRoutes(routesDir);
      
      if (isDev) {
        watchRoutes(routesDir);
      }

      const defaultHeadersEntries = defaultHeaders ? Object.entries(defaultHeaders) : [];

      const server = Bun.serve({
        port,
        async fetch(request) {
          const url = new URL(request.url);
          const responseEmitter = new EventEmitter();
          
          const bunReq = {
            ...request,
            url: url.pathname + url.search,
            method: request.method,
            headers: request.headers,
            socket: { setTimeout: (_: number) => {} },
            setTimeout: (_: number) => {},
            connection: {
              remoteAddress: request.headers.get("x-forwarded-for") || "127.0.0.1"
            },
            async text() { return await request.text(); },
            async json() { return await request.json(); }
          };
          
          const bunRes = {
            statusCode: 200,
            headers: new Headers(),
            body: null as any,
            headersSent: false,
            finished: false,
            writableEnded: false,
            on: (event: string, listener: (...args: any[]) => void) => {
              responseEmitter.on(event, listener);
              return bunRes;
            },
            once: (event: string, listener: (...args: any[]) => void) => {
              responseEmitter.once(event, listener);
              return bunRes;
            },
            emit: (event: string, ...args: any[]) => {
              return responseEmitter.emit(event, ...args);
            },
            setHeader(name: string, value: string) {
              this.headers.set(name, value);
              return this;
            },
            getHeader(name: string) {
              return this.headers.get(name);
            },
            removeHeader(name: string) {
              this.headers.delete(name);
              return this;
            },
            hasHeader(name: string) {
              return this.headers.has(name);
            },
            writeHead(statusCode: number, headers?: Record<string, string> | null) {
              this.statusCode = statusCode;
              if (headers && typeof headers === 'object') {
                Object.entries(headers).forEach(([key, value]) => {
                  this.headers.set(key, value);
                });
              }
              return this;
            },
            status(code: number) {
              this.statusCode = code;
              return this;
            },
            write(chunk: any) {
              if (this.body === null) this.body = '';
              this.body += chunk;
              return true;
            },
            end(data?: any) {
              if (data !== undefined) this.write(data);
              this.headersSent = true;
              this.finished = true;
              this.writableEnded = true;
              responseEmitter.emit('finish');
              return this;
            },
            send(data: any) {
              this.body = data;
              this.end();
              return this;
            },
            json(data: any) {
              this.setHeader("Content-Type", "application/json");
              this.body = JSON.stringify(data);
              this.end();
              return this;
            }
          };

          try {
            bunRes.setHeader('Connection', 'keep-alive');
            
            if (defaultHeadersEntries.length > 0) {
              for (let i = 0; i < defaultHeadersEntries.length; i++) {
                bunRes.setHeader(defaultHeadersEntries[i][0], defaultHeadersEntries[i][1]);
              }
            }

            const enhancedReq = transformRequest(bunReq as any);
            const enhancedRes = transformResponse(bunRes as any);

            const shouldContinue = await runMiddlewares('beforeRequest', enhancedReq, enhancedRes);
            if (!shouldContinue || enhancedRes.headersSent) {
              return new Response(enhancedRes.body, {
                status: enhancedRes.statusCode,
                headers: enhancedRes.headers
              });
            }

            const cacheKey = `${enhancedReq.method}:${url.pathname}`;
            let route = routeCache.get(cacheKey);
            
            if (!route) {
              route = findRoute(url.pathname, request.method);
              if (route) {
                routeCache.set(cacheKey, route);
                if (routeCache.size > MAX_ROUTE_CACHE) {
                  const keysToDelete = Array.from(routeCache.keys()).slice(0, MAX_ROUTE_CACHE / 10);
                  for (const key of keysToDelete) routeCache.delete(key);
                }
              }
            }
      
            if (!route) {
              enhancedRes.writeHead(404, { "Content-Type": "application/json" });
              enhancedRes.end(JSON.stringify({ error: "Route not found" }));
              return new Response(JSON.stringify({ error: "Route not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
              });
            }
      
            if ("error" in route) {
              const status = route.status || 500;
              enhancedRes.writeHead(status, { "Content-Type": "application/json" });
              enhancedRes.end(JSON.stringify({ error: route.error }));
              return new Response(JSON.stringify({ error: route.error }), { 
                status, 
                headers: { "Content-Type": "application/json" }
              });
            }
      
            enhancedReq.params = route.params;
            await route.handler(enhancedReq, enhancedRes);

            if (!enhancedRes.headersSent) {
              await runMiddlewares('afterRequest', enhancedReq, enhancedRes);
              
              if (!enhancedRes.headersSent) {
                enhancedRes.end();
              }
            }
            
            return new Response(enhancedRes.body, {
              status: enhancedRes.statusCode,
              headers: enhancedRes.headers
            });
          } catch (error) {
            if (isDev) {
              console.error("Server error:", error);
            }
            
            return new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
      });

      primaryLog(`🚀 Server started on http://localhost:${port}${isDev ? " (dev)" : ""}`);
    
      return {
        close: () => {
          server.stop();
        }
      };
    };
  },
  
  transformRequest: (req) => enhanceRequest(req),
  transformResponse: (res) => enhanceResponse(res),
};