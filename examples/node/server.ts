import { createServer } from "@core/server";
import { getRoutesDir } from "@core/router";

const routesDir = getRoutesDir();
createServer(routesDir);