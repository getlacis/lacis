import cluster from 'cluster';
import * as os from 'os';
import { primaryLog } from './logs';
import type { BalancerOptions, StatsMessage, WorkerStats } from "@/types"

function createLoadBalancer(options: Partial<BalancerOptions> = {}) {
  const reportInterval = options.reportInterval ?? 5000;

  const state = {
    workers: new Map<number, WorkerStats>(),
    workerIds: [] as number[],
  };

  function startWorker() {
    if (!cluster.isWorker) return;

    let prevCpu = process.cpuUsage();

    const reportStats = () => {
      if (!process.send) return;

      const memoryUsage = process.memoryUsage();
      const cpuDelta = process.cpuUsage(prevCpu);
      prevCpu = process.cpuUsage();
      // Fraction of one CPU core used during the last interval (0 = idle, 1 = fully busy)
      const load = (cpuDelta.user + cpuDelta.system) / (reportInterval * 1000);

      const msg: StatsMessage = {
        type: 'stats',
        stats: { pid: process.pid, load, lastUsed: Date.now(), memoryUsage }
      };
      process.send(msg);
    };

    reportStats();
    setInterval(reportStats, reportInterval).unref();
  }

  function forkWorker() {
    const worker = cluster.fork();
    state.workers.set(worker.id!, {
      pid: worker.process.pid!,
      load: 0,
      lastUsed: Date.now(),
      memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }
    });
    state.workerIds.push(worker.id!);
    primaryLog(`Worker ${worker.process.pid} started`);
  }

  let shuttingDown = false;
  const exitCallbacks: Array<() => void> = [];

  function start(numWorkers: number = os.cpus().length) {
    if (!cluster.isPrimary) {
      return startWorker();
    }

    primaryLog(`🧵 Launching ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) forkWorker();

    cluster.on('message', (worker, message: StatsMessage) => {
      if (message.type === 'stats' && 'stats' in message) {
        const s = state.workers.get(worker.id!);
        if (s) Object.assign(s, message.stats);
      }
    });

    cluster.on('exit', (worker, code, signal) => {
      state.workers.delete(worker.id!);
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
    getWorkerStats: () => Array.from(state.workers.entries()),
    getActiveWorkerCount: () => state.workerIds.length
  };
}

export { createLoadBalancer };
