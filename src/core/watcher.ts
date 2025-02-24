import { watch, type FSWatcher } from "fs";
import debounce from "@/utils/debounce";
import { loadRoutes } from "./router";
import { loadMiddlewares } from "./middleware";

let fileWatcher: FSWatcher | null = null;

function watchRoutes(routesDir: string) {
  if (fileWatcher) return;

  fileWatcher = watch(
    routesDir,
    { recursive: true },
    debounce(async (filename: string) => {
      if (filename) {
        if (filename.endsWith('+middleware.ts') || filename.endsWith('+middleware.js')) {
          console.log(`🔄 The hooks file "${filename}" has been modified, reloading hooks...`);
          await loadMiddlewares(routesDir);
        } else {
          console.log(`🔄 The file "${filename}" has been modified, reloading routes...`);
          await loadMiddlewares(routesDir);
        }
      } else {
        console.log("🔄 Changes detected, reloading routes and middlewares...");
        await loadRoutes(routesDir);
      }
    }, 300)
  );
}

export { watchRoutes };