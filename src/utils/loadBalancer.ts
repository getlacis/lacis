import cluster from 'cluster';
import * as os from 'os';
import { primaryLog } from './logs';
import type { BalancerOptions, ConnectionMessage, ReadyMessage, ShutdownMessage, StatsMessage, StatsUpdateMessage, WorkerStats } from "@/types"


type WorkerMessage = StatsMessage | StatsUpdateMessage | ConnectionMessage | ShutdownMessage | ReadyMessage;

function createLoadBalancer(options: Partial<BalancerOptions> = {}) {
  const state = {
    workers: new Map<number, WorkerStats>(),
    workerIds: [] as number[],
    currentWorkerIndex: 0,
    options: {
      algorithm: options.algorithm || 'least-connections',
      reportInterval: options.reportInterval || 5000,
      stickySessions: options.stickySessions || false
    },
    sticky: new Map<string, number>() 
  };

  function startWorker() {
    if (!cluster.isWorker) return;

    const reportStats = () => {
      if (!process.send) return;
      
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const load = (cpuUsage.user + cpuUsage.system) / 1000000; 

      const statsMessage: StatsMessage = {
        type: 'stats',
        stats: {
          pid: process.pid,
          load,
          connections: 0, 
          lastUsed: Date.now(),
          memoryUsage
        }
      };

      process.send(statsMessage);
    };

    reportStats();
    setInterval(reportStats, state.options.reportInterval);

    process.on('message', (message: WorkerMessage) => {
      if (message.type === 'connection-start') {
        if (!process.send) return;
        const statsUpdateMessage: StatsUpdateMessage = {
          type: 'stats-update',
          connectionChange: 1
        };
        process.send(statsUpdateMessage);
      } else if (message.type === 'connection-end') {
        if (!process.send) return;
        const statsUpdateMessage: StatsUpdateMessage = {
          type: 'stats-update',
          connectionChange: -1
        };
        process.send(statsUpdateMessage);
      }
    });
  }

  function forkWorker() {
    const worker = cluster.fork();
    
    state.workers.set(worker.id!, {
      pid: worker.process.pid!,
      load: 0,
      connections: 0,
      lastUsed: Date.now(),
      memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }
    });
    
    state.workerIds.push(worker.id!);
    primaryLog(`Worker ${worker.process.pid} started`);
  }

  function updateWorkerStats(workerId: number, stats: Partial<WorkerStats>) {
    const workerStats = state.workers.get(workerId);
    if (workerStats) {
      Object.assign(workerStats, stats);
    }
  }

  function getRoundRobinWorker() {
    state.currentWorkerIndex = (state.currentWorkerIndex + 1) % state.workerIds.length;
    return state.workerIds[state.currentWorkerIndex];
  }

  function getLeastConnectionsWorker() {
    let minConnections = Infinity;
    let selectedWorkerId = state.workerIds[0];

    for (const workerId of state.workerIds) {
      const stats = state.workers.get(workerId);
      if (stats && stats.connections < minConnections) {
        minConnections = stats.connections;
        selectedWorkerId = workerId;
      }
    }

    return selectedWorkerId;
  }

  function getLeastCpuWorker() {
    let minLoad = Infinity;
    let selectedWorkerId = state.workerIds[0];

    for (const workerId of state.workerIds) {
      const stats = state.workers.get(workerId);
      if (stats && stats.load < minLoad) {
        minLoad = stats.load;
        selectedWorkerId = workerId;
      }
    }

    return selectedWorkerId;
  }

  function getFastestResponseWorker() {
    let oldestTime = Infinity;
    let selectedWorkerId = state.workerIds[0];

    for (const workerId of state.workerIds) {
      const stats = state.workers.get(workerId);
      if (stats && stats.lastUsed < oldestTime) {
        oldestTime = stats.lastUsed;
        selectedWorkerId = workerId;
      }
    }

    return selectedWorkerId;
  }

  function logStats() {
    if (!cluster.isPrimary) return;

    primaryLog('========= Worker Stats =========');
    primaryLog(`Active workers: ${state.workerIds.length}`);
    
    const stats = Array.from(state.workers.entries())
      .map(([id, stats]) => ({
        id,
        pid: stats.pid,
        connections: stats.connections,
        load: stats.load.toFixed(2),
        memory: `${Math.round(stats.memoryUsage.rss / 1024 / 1024)}MB`
      }));
    
    console.table(stats);
    primaryLog('===============================');
  }

  function getNextWorker(clientIp?: string) {
    if (!cluster.isPrimary || state.workerIds.length === 0) {
      return undefined;
    }

    if (state.options.stickySessions && clientIp && state.sticky.has(clientIp)) {
      const workerId = state.sticky.get(clientIp);
      if (workerId && state.workers.has(workerId)) {
        return workerId;
      }
      state.sticky.delete(clientIp);
    }

    let selectedWorkerId: number;

    switch (state.options.algorithm) {
      case 'round-robin':
        selectedWorkerId = getRoundRobinWorker();
        break;
      case 'least-connections':
        selectedWorkerId = getLeastConnectionsWorker();
        break;
      case 'least-cpu':
        selectedWorkerId = getLeastCpuWorker();
        break;
      case 'fastest-response':
        selectedWorkerId = getFastestResponseWorker();
        break;
      default:
        selectedWorkerId = getRoundRobinWorker();
    }

    if (state.options.stickySessions && clientIp) {
      state.sticky.set(clientIp, selectedWorkerId);
      
      if (state.sticky.size > 10000) {
        const keysToDelete = Array.from(state.sticky.keys()).slice(0, 1000);
        keysToDelete.forEach(key => state.sticky.delete(key));
      }
    }

    return selectedWorkerId;
  }

  function start(numWorkers: number = os.cpus().length) {
    if (!cluster.isPrimary) {
      return startWorker();
    }

    primaryLog(`🔄 Starting load balancer with '${state.options.algorithm}' algorithm`);
    primaryLog(`🧵 Launching ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
      forkWorker();
    }

    cluster.on('message', (worker, message: WorkerMessage) => {
      if (message.type === 'stats' && 'stats' in message) {
        updateWorkerStats(worker.id!, message.stats);
      }
    });

    cluster.on('exit', (worker, code, signal) => {
      primaryLog(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      state.workers.delete(worker.id!);
      state.workerIds = state.workerIds.filter(id => id !== worker.id);
      
      setTimeout(() => forkWorker(), 1000);
    });


    setInterval(() => {
      logStats();
    }, 60000); 
  }

  return {
    start,
    getNextWorker,
    getWorkerStats: () => Array.from(state.workers.entries()),
    getActiveWorkerCount: () => state.workerIds.length
  };
}

export { createLoadBalancer };