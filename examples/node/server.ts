import { createServer } from "@core/server";
import { getRoutesDir } from "@core/router";

const routesDir = getRoutesDir();
createServer(routesDir, { isDev: false, platform: 'node', port: 8888, cluster: { enabled: true, workers: undefined, loadBalancing: "fastest-response" }, monitoring: { enabled: false, sampleInterval: 1000, reportInterval: 5000, thresholds: { cpu: 80, memory: 80, responseTime: 1000, errorRate: 5 } } });