import http from "http";
import https from "https";
import { loadRoutes, findRoute } from "./router";
import { watchRoutes } from "./watcher";
import { defaultConfig, type ServerConfig } from "@/config/serverConfig";

async function createServer(
  routesDir: string,
  config: ServerConfig = defaultConfig
) {
  const { isDev, port } = config;
  await loadRoutes(routesDir);

  if (isDev) {
    watchRoutes(routesDir);
    console.log("🔥 Mode dev activé");
  }

  const requestListener: http.RequestListener = async (req, res) => {
    try {
      const route = findRoute(req.url || "/", req.method || "GET");

      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Route not found" }));
        return;
      }

      if ("error" in route) {
        const status = route.status || 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: route.error }));
        return;
      }

      (req as any).params = route.params;
      await route.handler(req, res);
    } catch (error) {
      console.error("Server error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  };

  const server = isDev
    ? http.createServer(requestListener)
    : https.createServer(
        {
          /* HTTPs options  */
        },
        requestListener
      ); // TODO: add HTTPS options

  server.listen(port, () => {
    console.log(
      `🚀 Server started on ${isDev ? "http" : "https"}://localhost:${port} ${
        isDev ? "(dev)" : ""
      }`
    );
  });

  return server;
}

export { createServer };
