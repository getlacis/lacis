import cluster from 'cluster';
import * as os from 'os';
import { primaryLog } from './logs';

// Supervises cluster workers: forks them, restarts them on unexpected exit, and
// coordinates graceful shutdown. Request distribution is handled by the OS
// (round-robin via SCHED_RR set in the node adapter), not by this module — there
// is no application-level load balancing.
function createWorkerSupervisor() {
  const state = {
    workerIds: [] as number[],
  };

  function forkWorker() {
    const worker = cluster.fork();
    state.workerIds.push(worker.id!);
    primaryLog(`Worker ${worker.process.pid} started`);
  }

  let shuttingDown = false;
  const exitCallbacks: Array<() => void> = [];

  function start(numWorkers: number = os.cpus().length) {
    if (!cluster.isPrimary) return;

    primaryLog(`🧵 Launching ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) forkWorker();

    cluster.on('exit', (worker, code, signal) => {
      state.workerIds = state.workerIds.filter(id => id !== worker.id);

      if (shuttingDown) {
        exitCallbacks.forEach(cb => cb());
        return;
      }

      primaryLog(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      setTimeout(() => forkWorker(), 1000);
    });
  }

  function shutdown(callback?: () => void) {
    shuttingDown = true;

    const workerIds = Object.keys(cluster.workers ?? {});
    if (workerIds.length === 0) {
      callback?.();
      return;
    }

    let remaining = workerIds.length;
    exitCallbacks.push(() => {
      remaining--;
      if (remaining === 0) callback?.();
    });

    for (const id of workerIds) cluster.workers?.[id as any]?.kill();
  }

  return {
    start,
    shutdown,
    getActiveWorkerCount: () => state.workerIds.length,
  };
}

export { createWorkerSupervisor };
