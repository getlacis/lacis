interface WorkerStats {
  pid: number;
  load: number;
  connections: number;
  lastUsed: number;
  memoryUsage: NodeJS.MemoryUsage;
}

interface BalancerOptions {
  algorithm:
    | "round-robin"
    | "least-connections"
    | "least-cpu"
    | "fastest-response";
  reportInterval?: number; // How often workers report their stats
  stickySessions?: boolean; // Enable sticky sessions based on client IP
}

// Message type definitions
interface StatsMessage {
  type: "stats";
  stats: Partial<WorkerStats>;
}

interface StatsUpdateMessage {
  type: "stats-update";
  connectionChange: number;
}

interface ConnectionMessage {
  type: "connection-start" | "connection-end";
}

interface ShutdownMessage {
  type: "shutdown";
}

interface ReadyMessage {
  type: "ready";
}

export type { WorkerStats, BalancerOptions, StatsMessage, StatsUpdateMessage, ConnectionMessage, ShutdownMessage, ReadyMessage };
