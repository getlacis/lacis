interface WorkerStats {
  pid: number;
  load: number;
  lastUsed: number;
  memoryUsage: NodeJS.MemoryUsage;
}

interface BalancerOptions {
  reportInterval?: number;
}

interface StatsMessage {
  type: "stats";
  stats: Partial<WorkerStats>;
}

export type { WorkerStats, BalancerOptions, StatsMessage };
