import { watch, type FSWatcher } from "fs";
import debounce from "@/utils/debounce";
import { loadRoutes, setVerboseLogging } from "./router";
import { existsSync } from "fs";
import { primaryLog } from "@/utils/logs";

let fileWatcher: FSWatcher | null = null;
let isWatching = false;
let isReloading = false;

function watchRoutes(routesDir: string, verbose: boolean = false) {
  if (isWatching && !verbose) {
    return;
  }

  if (fileWatcher) {
    fileWatcher.close(); 
    fileWatcher = null;
  }

  if (!existsSync(routesDir)) {
    console.error(`Directory '${routesDir}' does not exist. Cannot watch.`);
    return;
  }

  setVerboseLogging(verbose);

  const debouncedReload = debounce(async (filename: string | null) => {
    if (isReloading) return;
    isReloading = true;

    try {
      if (verbose) {
        primaryLog(`🔄 Change detected${filename ? ` in "${filename}"` : ""}, reloading...`);
      }
      
      await loadRoutes(routesDir);
      
      if (verbose) {
        primaryLog('✅ Routes reloaded successfully');
      }
    } catch (error) {
      if (verbose) {
        primaryLog('❌ Error reloading routes:', error);
      }
    } finally {
      isReloading = false;
    }
  }, 500);

  try {
    const listener = (eventType: string, filename: string | Buffer | null) => {
      if (!filename) return;
      
      const filenameStr = Buffer.isBuffer(filename) 
        ? filename.toString() 
        : filename;
      
      if (filenameStr.startsWith('.') || filenameStr.endsWith('~')) {
        return;
      }
      
      debouncedReload(filenameStr);
    };

    fileWatcher = watch(
      routesDir,
      { recursive: true },
      listener
    );
    
    isWatching = true;
    
    if (verbose) {
      primaryLog(`👀 Watching directory '${routesDir}'`);
    }
  } catch (error) {
    if (verbose) {
      primaryLog(`❌ Error initializing watcher:`, error);
    }
    isWatching = false;
  }
}

function stopWatching() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
    isWatching = false;
  }
}

process.on('SIGINT', () => {
  stopWatching();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWatching();
  process.exit(0);
});

export { watchRoutes, stopWatching };