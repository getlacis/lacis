interface MetricValue {
  min: number;
  max: number;
  avg: number;
  count: number;
  sum: number;
  p50?: number; // percentile 50
  p90?: number;
  p99?: number;
}

interface Metrics {
  timestamp: number;
  uptime: number;
  requestCount: number;
  activeRequests: number;
  errorCount: number;
  responseTimes: MetricValue;
  statusCodes: Record<number, number>;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    usage: number;
    system: number;
    user: number;
  };
  systemLoad: number[];
  systemMemory: {
    total: number;
    free: number;
    used: number;
  };
}

interface PerformanceData {
  startTime: number;
  requestCount: number;
  activeRequests: number;
  errorCount: number;
  responseTimes: number[];
  statusCodes: Record<number, number>;
  responseTimesBucket: number[];
  lastReport: number;
  lastReset: number;
}

interface MonitorOptions {
  sampleInterval?: number;
  reportInterval?: number;
  resetInterval?: number;
  enableHistogram?: boolean;
  logToConsole?: boolean;
  thresholds?: {
    cpu?: number;
    memory?: number;
    responseTime?: number;
    errorRate?: number;
  };
}

interface AlarmStatus {
  cpu: boolean;
  memory: boolean;
  responseTime: boolean;
  errorRate: boolean;
}

export type { Metrics, MonitorOptions, PerformanceData, AlarmStatus, MetricValue };
