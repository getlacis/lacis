import { createServer } from "@core/server";
import { getRoutesDir } from "@core/router";

const routesDir = getRoutesDir();
createServer(routesDir, { isDev: true, port: 3000, cluster: { enabled: true, workers: undefined } });