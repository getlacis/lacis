import { createServer } from "@core/server";
import { getRoutesDir } from "@core/router";

const routesDir = getRoutesDir();
createServer(routesDir, { isDev: true, platform: 'bun', port: 3000, cluster: { enabled: false, workers: undefined } });