import type { Adapter, ServerConfig } from "@/types";
import { type Server } from "bun";
import os from "os";
import cluster from "cluster";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { addMiddleware, runMiddlewares } from "@/core/middleware";
import { createTimeoutMiddleware } from "@/utils/timeout";
import { primaryLog } from "@/utils/logs";
import { EventEmitter } from "events";

export const bunAdapter: Adapter = {
  name: "bun",
  createHandler: (routesDir: string) => {
    const transformRequest = bunAdapter.transformRequest!;
    const transformResponse = bunAdapter.transformResponse!;

    return async (config: ServerConfig = {}) => {
      const { isDev, port = 3000, defaultHeaders, globalMiddlewares, cluster: clusterConfig } = config;
      
      if (cluster.isPrimary) {
        primaryLog("🚀 Bun performance optimizations enabled");
        primaryLog("   - Using Bun's native HTTP server with optimal defaults");
      }
      
      if (clusterConfig?.enabled && cluster.isPrimary) {
        const numWorkers = clusterConfig.workers || os.cpus().length;
        
        primaryLog(`🧵 Starting server with ${numWorkers} workers`);
        
        for (let i = 0; i < numWorkers; i++) {
          cluster.fork();
        }
        
        cluster.on('exit', (worker, code, signal) => {
          primaryLog(`Worker ${worker.process.pid} died with ${signal || code}. Restarting...`);
          setTimeout(() => {
            const newWorker = cluster.fork();
            primaryLog(`New worker ${newWorker.process.pid} started to replace ${worker.process.pid}`);
          }, 1000);
        });
        
        cluster.on('message', (worker, message) => {
          if (message.type === 'ready') {
            primaryLog(`Worker ${worker.process.pid} is ready`);
          }
        });
        
        return { close: () => {} };
      }
      
      await loadRoutes(routesDir);
      
      if (isDev && cluster.isPrimary) {
        watchRoutes(routesDir);
      }

      let server: Server;

      server = Bun.serve({
        port,
        async fetch(request) {
          const url = new URL(request.url);
          const responseEmitter = new EventEmitter();
          const bunReq = {
            ...request,
            url: url.pathname + url.search,
            method: request.method,
            headers: request.headers,
            socket: {
              setTimeout: (_: number) => {} // Dummy implementation
            },
            setTimeout: (_: number) => {},
            rawHeaders: request.headers,
            connection: {
              remoteAddress: request.headers.get("x-forwarded-for") || "127.0.0.1"
            },
            async text() {
              return await request.text();
            },
            async json() {
              return await request.json();
            }
          };
          
          // TODO: Make an "helper" function to create a response object
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
            removeListener: (event: string, listener: (...args: any[]) => void) => {
              responseEmitter.removeListener(event, listener);
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
            writeHead(statusCode: number, headers?: Record<string, string> | string[] | null) {
              this.statusCode = statusCode;
              if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
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
              if (this.body === null) {
                this.body = '';
              }
              this.body += chunk;
              return true;
            },
            end(data?: any) {
              if (data !== undefined) {
                this.write(data);
              }
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
            if (!request.headers.get("connection") || request.headers.get("connection") !== 'close') {
              bunRes.setHeader('Connection', 'keep-alive');
              bunRes.setHeader('Keep-Alive', 'timeout=5, max=1000');
            }

            const enhancedReq = transformRequest(bunReq as any);
            const enhancedRes = transformResponse(bunRes as any);

            if (defaultHeaders) {
              Object.entries(defaultHeaders).forEach(([key, value]) => {
                enhancedRes.setHeader(key, value);
              });
            }

            if (globalMiddlewares?.beforeRequest) {
              const result = await globalMiddlewares.beforeRequest(enhancedReq, enhancedRes);
              if (!result) {
                if (!enhancedRes.headersSent) {
                  enhancedRes.end();
                }
                return new Response(enhancedRes.body, {
                  status: enhancedRes.statusCode,
                  headers: enhancedRes.headers
                });
              }
            }

            const shouldContinue = await runMiddlewares('beforeRequest', enhancedReq, enhancedRes);
            if (!shouldContinue) {
              if (!enhancedRes.headersSent) {
                enhancedRes.end();
              }
              return new Response(enhancedRes.body, {
                status: enhancedRes.statusCode,
                headers: enhancedRes.headers
              });
            }
            
            const timeoutMiddleware = createTimeoutMiddleware(config);
            addMiddleware("beforeRequest", timeoutMiddleware);

            const route = findRoute(url.pathname, request.method);
      
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

            if (globalMiddlewares?.afterRequest) {
              const result = await globalMiddlewares.afterRequest(enhancedReq, enhancedRes);
              if (!result && !enhancedRes.headersSent) {
                enhancedRes.end();
              }
            }

            await runMiddlewares('afterRequest', enhancedReq, enhancedRes);
            
            // Make sure the response is properly ended
            if (!enhancedRes.headersSent) {
              enhancedRes.end();
            }
            
            return new Response(enhancedRes.body, {
              status: enhancedRes.statusCode,
              headers: enhancedRes.headers
            });

          } catch (error) {
            console.error("Server error:", error);

            if (globalMiddlewares?.onError) {
              await globalMiddlewares.onError(bunReq as any, bunRes as any, error);
            }

            await runMiddlewares('onError', bunReq as any, bunRes as any, error);
            
            if (!bunRes.headersSent) {
              bunRes.writeHead(500, { "Content-Type": "application/json" });
              bunRes.end(JSON.stringify({ error: "Internal Server Error" }));
            }
            
            return new Response(bunRes.body || JSON.stringify({ error: "Internal Server Error" }), {
              status: bunRes.statusCode || 500,
              headers: bunRes.headers
            });
          }
        },
        error(error) {
          console.error("Server error:", error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      });

      if (cluster.isPrimary) {
        primaryLog(`🚀 Server started on http://localhost:${port}${isDev ? " (dev)" : ""}`);
      }
      
      if (cluster.isWorker && process.send) {
        process.send({ type: 'ready' });
      }
    
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