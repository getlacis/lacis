import { watch, type FSWatcher } from "fs";
import debounce from "@/utils/debounce";
import { loadRoutes, setVerboseLogging } from "./router";
import { existsSync } from "fs";

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
    console.error(`Le dossier '${routesDir}' n'existe pas. Surveillance impossible.`);
    return;
  }

  setVerboseLogging(verbose);

  const debouncedReload = debounce(async (filename: string | null) => {
    if (isReloading) return;
    isReloading = true;

    try {
      if (verbose) {
        console.log(`🔄 Changement détecté${filename ? ` dans "${filename}"` : ""}, rechargement...`);
      }
      
      await loadRoutes(routesDir);
      
      if (verbose) {
        console.log('✅ Routes rechargées');
      }
    } catch (error) {
      if (verbose) {
        console.error('❌ Erreur lors du rechargement des routes:', error);
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
      console.log(`👀 Surveillance du dossier '${routesDir}' activée`);
    }
  } catch (error) {
    if (verbose) {
      console.error(`❌ Erreur lors de l'initialisation de la surveillance:`, error);
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