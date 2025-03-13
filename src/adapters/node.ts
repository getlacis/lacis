import http, { globalAgent } from "http";
import https from "https";
import cluster from "cluster";
import os from "os";
import type { Adapter, ServerConfig } from "@/types";
import { loadRoutes, findRoute } from "@/core/router";
import { watchRoutes } from "@/core/watcher";
import { enhanceRequest, enhanceResponse } from "@/utils/enhancer";
import { addMiddleware, runMiddlewares } from "@/core/middleware";
import { createTimeoutMiddleware } from "@/utils/timeout";
import { primaryLog } from "@/utils/logs";
import { setupGracefulShutdown } from "@/utils/gracefulShutdown";
import { createLoadBalancer } from "@/utils/loadBalancer";
import { getMonitor } from "@/utils/monitor";

export const nodeAdapter: Adapter = {
  name: "node",
  createHandler: (routesDir: string) => {
    const transformRequest = nodeAdapter.transformRequest!;
    const transformResponse = nodeAdapter.transformResponse!;

    return async (config: ServerConfig = {}) => {
      const {
        isDev,
        port = 3000,
        defaultHeaders,
        globalMiddlewares,
        cluster: clusterConfig,
        monitoring = { enabled: false }
      } = config;
      
      let performanceMonitor = null;
      if (monitoring.enabled) {
        performanceMonitor = getMonitor({
          sampleInterval: monitoring.sampleInterval || 5000,
          reportInterval: monitoring.reportInterval || 60000,
          thresholds: monitoring.thresholds
        });
        
        if (cluster.isPrimary) {
          primaryLog("📊 Performance monitoring activé");
          performanceMonitor.on('alarm', (metricType, message) => {
            primaryLog(`⚠️ ALERTE: ${message}`);
          });
          performanceMonitor.on('alarm-clear', (metricType, message) => {
            primaryLog(`✅ RÉSOLU: ${message}`);
          });
        }
      }
      
      // Traitement pour le processus principal (master)
      if (clusterConfig?.enabled && cluster.isPrimary) {
        const numWorkers = clusterConfig.workers || os.cpus().length;
        
        // Créer l'équilibreur de charge si configuré
        const loadBalancer = createLoadBalancer({
          algorithm: clusterConfig.loadBalancing || 'least-connections',
          stickySessions: clusterConfig.stickySessions || false
        });
        
        primaryLog(`🧵 Démarrage du serveur avec ${numWorkers} workers`);
        
        // Démarrer l'équilibreur de charge
        loadBalancer.start(numWorkers);
        
        // Gérer la sortie des workers
        cluster.on("exit", (worker, code, signal) => {
          primaryLog(
            `Worker ${worker.process.pid} est mort avec ${
              signal || code
            }. Redémarrage...`
          );
          setTimeout(() => {
            const newWorker = cluster.fork();
            primaryLog(
              `Nouveau worker ${newWorker.process.pid} démarré pour remplacer ${worker.process.pid}`
            );
          }, 1000);
        });

        // Gérer les messages des workers
        cluster.on("message", (worker, message) => {
          if (message.type === "ready") {
            primaryLog(`Worker ${worker.process.pid} est prêt`);
          } else if (message.type === 'metrics' && message.metrics) {
            // Traiter les métriques des workers si nécessaire
          } else if (message.type === 'response-time' && message.responseTime) {
            // Mise à jour des temps de réponse pour l'algorithme fastest-response
            if (loadBalancer) {
              // Le worker a terminé de traiter une requête
            }
          }
        });

        return { close: () => {
          // Envoyer un signal d'arrêt à tous les workers
          for (const id in cluster.workers) {
            cluster.workers[id]?.send({ type: 'shutdown' });
          }
        }};
      }

      // Chargement des routes
      await loadRoutes(routesDir);

      // Mode dev: surveiller les changements de fichiers
      if (isDev && cluster.isPrimary) {
        watchRoutes(routesDir);
      }

      // Gestionnaire de requêtes
      const requestListener: http.RequestListener = async (req, res) => {
        // Suivre la requête pour les métriques
        const requestTracker = performanceMonitor?.trackRequest();
        const startTime = Date.now();
        
        req.setTimeout(30000); // 30 secondes

        if (req.headers.connection !== "close") {
          res.setHeader("Connection", "keep-alive");
          res.setHeader("Keep-Alive", "timeout=5, max=1000");
        }

        const enhancedReq = transformRequest(req);
        const enhancedRes = transformResponse(res);

        try {
          // Appliquer les en-têtes par défaut
          if (defaultHeaders) {
            Object.entries(defaultHeaders).forEach(([key, value]) => {
              res.setHeader(key, value);
            });
          }

          // Exécuter les middlewares globaux
          if (globalMiddlewares?.beforeRequest) {
            const result = await globalMiddlewares.beforeRequest(
              enhancedReq,
              enhancedRes
            );
            if (!result) {
              requestTracker?.end(enhancedRes.statusCode || 400);
              return;
            }
          }

          // Exécuter les middlewares spécifiques
          const shouldContinue = await runMiddlewares(
            "beforeRequest",
            enhancedReq,
            enhancedRes
          );
          if (!shouldContinue) {
            requestTracker?.end(enhancedRes.statusCode || 400);
            return;
          }

          // Ajouter middleware de timeout
          const timeoutMiddleware = createTimeoutMiddleware(config);
          addMiddleware("beforeRequest", timeoutMiddleware);

          if (performanceMonitor && enhancedReq.url === '/health') {
                    res.setHeader('Content-Type', 'application/json');
                    return enhancedRes.status(200).json(performanceMonitor.getHealthMetrics());
          }

          // Trouver la route correspondante
          const route = findRoute(
            enhancedReq.url || "/",
            enhancedReq.method || "GET"
          );

          if (!route) {
            enhancedRes
              .status(404)
              .setHeader("Content-Type", "application/json")
              .json({ error: "Route not found" });
            requestTracker?.end(404);
            return;
          }

          if ("error" in route) {
            const status = route.status || 500;
            enhancedRes
              .status(status)
              .setHeader("Content-Type", "application/json")
              .json({ error: route.error });
            requestTracker?.end(status, true);
            return;
          }

          // Exécuter le gestionnaire de route
          enhancedReq.params = route.params;
          await route.handler(enhancedReq, enhancedRes);

          // Exécuter les middlewares après la requête
          if (globalMiddlewares?.afterRequest) {
            const result = await globalMiddlewares.afterRequest(
              enhancedReq,
              enhancedRes
            );
            if (!result) {
              requestTracker?.end(enhancedRes.statusCode || 500);
              return;
            }
          }

          await runMiddlewares("afterRequest", enhancedReq, enhancedRes);
          
          // Terminer le suivi de la requête avec le code de statut
          const responseTime = requestTracker?.end(enhancedRes.statusCode || 200);
          
          // Envoyer le temps de réponse au processus principal pour l'équilibrage de charge
          if (cluster.isWorker && process.send && cluster.worker) {
            process.send({
              type: 'response-time',
              workerId: cluster.worker.id,
              requestId: Math.random().toString(36).substring(2, 15),
              responseTime: responseTime || 0
            });
          }
        } catch (error) {
          console.error("Server error:", error);

          // Gérer les erreurs
          if (globalMiddlewares?.onError) {
            const result = await globalMiddlewares.onError(
              enhancedReq,
              enhancedRes,
              error
            );
            if (!result) {
              requestTracker?.end(500, true);
              return;
            }
          }

          await runMiddlewares("onError", enhancedReq, enhancedRes, error);

          if (!res.headersSent) {
            enhancedRes.status(500).json({ error: "Internal Server Error" });
          }
          
          // Suivre l'erreur
          requestTracker?.end(enhancedRes.statusCode || 500, true);
        }
      };

      // Options du serveur
      const serverOptions = {
        keepAliveTimeout: 120000,
        maxHeadersCount: 100,
        headersTimeout: 60000,
        requestTimeout: 300000,
      };

      // Créer le serveur HTTP ou HTTPS
      const server = isDev
        ? http.createServer(
            {
              ...serverOptions,
            },
            requestListener
          )
        : https.createServer(
            {
              ...serverOptions,
              ...(config.httpsOptions || {})
            },
            requestListener
          );

      server.maxConnections = 10000;
      
      // Configurer l'arrêt gracieux
      const gracefulShutdown = setupGracefulShutdown(server, {
        timeout: 30000,
        beforeShutdown: async () => {
          primaryLog("Fermeture gracieuse du serveur...");
        },
        onShutdown: async () => {
          primaryLog("Le serveur a été arrêté avec succès");
          if (performanceMonitor) {
            performanceMonitor.stop();
            primaryLog("Monitoring des performances arrêté");
          }
        }
      });
      
      // Gérer le message d'arrêt du processus principal
      if (cluster.isWorker) {
        process.on('message', (message: { type: string }) => {
          if (message.type === 'shutdown') {
            gracefulShutdown.shutdown('SIGTERM');
          }
        });
      }

      // Démarrer le serveur
      server.listen(port, () => {
        if (cluster.isPrimary) {
          primaryLog(
            `🚀 Serveur démarré sur ${
              isDev ? "http" : "https"
            }://localhost:${port}${isDev ? " (dev)" : ""}`
          );
        }
      });

      // Signaler que le worker est prêt
      if (cluster.isWorker && process.send) {
        process.send({ type: "ready" });
      }
      
      // Ajouter une route de health check si le monitoring est activé
      if (performanceMonitor) {
        const originalFindRoute = findRoute;
        (global as any).findRoute = (url: string, method: string) => {
          if (url === '/health' && method === 'GET') {
            return {
              handler: async (_req: any, res: any) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(performanceMonitor.getHealthMetrics()));
              },
              params: {}
            };
          }
          return originalFindRoute(url, method);
        };
      }

      return server;
    };
  },
  transformRequest: (req) => enhanceRequest(req),
  transformResponse: (res) => enhanceResponse(res),
};