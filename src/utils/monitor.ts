import * as os from 'os';
import cluster from 'cluster';
import { EventEmitter } from 'events';
import { primaryLog } from './logs';
import type { Metrics, MetricValue, PerformanceData, MonitorOptions, AlarmStatus } from '@/types';


let monitorInstance: ReturnType<typeof createMonitor> | null = null;

function createMonitor(options: MonitorOptions = {}) {
  const emitter = new EventEmitter();
  
  const config = {
    sampleInterval: options.sampleInterval || 5000,
    reportInterval: options.reportInterval || 60000,
    resetInterval: options.resetInterval || 24 * 60 * 60 * 1000,
    enableHistogram: options.enableHistogram !== undefined ? options.enableHistogram : true,
    logToConsole: options.logToConsole !== undefined ? options.logToConsole : true,
    thresholds: {
      cpu: options.thresholds?.cpu || 80,
      memory: options.thresholds?.memory || 80,
      responseTime: options.thresholds?.responseTime || 1000,
      errorRate: options.thresholds?.errorRate || 5
    }
  };

  const now = Date.now();
  const data: PerformanceData = {
    startTime: now,
    requestCount: 0,
    activeRequests: 0,
    errorCount: 0,
    responseTimes: [],
    responseTimesBucket: Array(100).fill(0), 
    statusCodes: {},
    lastReport: now,
    lastReset: now
  };

  let metrics = getInitialMetrics();
  let metricsHistory: Metrics[] = [];
  let lastCpuUsage = process.cpuUsage();
  
  const alarmStatus: AlarmStatus = {
    cpu: false,
    memory: false,
    responseTime: false,
    errorRate: false
  };

  function getInitialMetrics(): Metrics {
    return {
      timestamp: Date.now(),
      uptime: process.uptime(),
      requestCount: 0,
      activeRequests: 0,
      errorCount: 0,
      responseTimes: {
        min: 0,
        max: 0,
        avg: 0,
        count: 0,
        sum: 0
      },
      statusCodes: {},
      memory: process.memoryUsage(),
      cpu: {
        usage: 0,
        system: 0,
        user: 0
      },
      systemLoad: os.loadavg(),
      systemMemory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      }
    };
  }

  function calculateResponseTimeMetrics(): MetricValue {
    const responseTimes = data.responseTimes;
    if (responseTimes.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        count: 0,
        sum: 0
      };
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (const time of responseTimes) {
      min = Math.min(min, time);
      max = Math.max(max, time);
      sum += time;
    }

    const avg = sum / responseTimes.length;
    const result: MetricValue = {
      min,
      max,
      avg,
      count: responseTimes.length,
      sum
    };

    if (config.enableHistogram) {
      const sorted = [...responseTimes].sort((a, b) => a - b);
      result.p50 = sorted[Math.floor(sorted.length * 0.5)];
      result.p90 = sorted[Math.floor(sorted.length * 0.9)];
      result.p99 = sorted[Math.floor(sorted.length * 0.99)];
    }

    return result;
  }

  function sampleMetrics() {
    const now = Date.now();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    
    const cpuTotal = cpuUsage.user + cpuUsage.system;
    const cpuPercentage = (cpuTotal / 1000 / config.sampleInterval) * 100;
    
    metrics = {
      timestamp: now,
      uptime,
      requestCount: data.requestCount,
      activeRequests: data.activeRequests,
      errorCount: data.errorCount,
      responseTimes: calculateResponseTimeMetrics(),
      statusCodes: { ...data.statusCodes },
      memory: memoryUsage,
      cpu: {
        usage: cpuPercentage,
        system: cpuUsage.system,
        user: cpuUsage.user
      },
      systemLoad: os.loadavg(),
      systemMemory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      }
    };

    metricsHistory.push({ ...metrics });
    if (metricsHistory.length > 100) {
      metricsHistory.shift();
    }

    checkThresholds();

    if (cluster.isWorker && process.send) {
      process.send({ type: 'metrics', metrics });
    }
  }

  function reportMetrics() {
    if (!config.logToConsole) return;
    if (cluster.isPrimary === false) return;

    const memoryMB = {
      rss: (metrics.memory.rss / 1024 / 1024).toFixed(2),
      heapTotal: (metrics.memory.heapTotal / 1024 / 1024).toFixed(2),
      heapUsed: (metrics.memory.heapUsed / 1024 / 1024).toFixed(2)
    };

    const elapsedMs = Date.now() - data.lastReport;
    const requestsPerSecond = (metrics.requestCount / (elapsedMs / 1000)).toFixed(2);
    const errorRate = metrics.requestCount ? ((metrics.errorCount / metrics.requestCount) * 100).toFixed(2) : '0.00';

    primaryLog('\n📊 Server Performance Metrics 📊');
    primaryLog(`Uptime: ${formatUptime(metrics.uptime)}`);
    primaryLog(`Load: ${metrics.systemLoad[0].toFixed(2)}, ${metrics.systemLoad[1].toFixed(2)}, ${metrics.systemLoad[2].toFixed(2)}`);
    primaryLog(`Requests: ${metrics.requestCount} total, ${requestsPerSecond} req/sec`);
    primaryLog(`Active Requests: ${metrics.activeRequests}`);
    primaryLog(`Errors: ${metrics.errorCount} (${errorRate}%)`);
    
    if (metrics.responseTimes.count > 0) {
      primaryLog(`Response Times: avg ${metrics.responseTimes.avg.toFixed(2)}ms, min ${metrics.responseTimes.min}ms, max ${metrics.responseTimes.max}ms`);
      if (metrics.responseTimes.p50) {
        primaryLog(`Response Time Percentiles: p50 ${metrics.responseTimes.p50}ms, p90 ${metrics.responseTimes.p90}ms, p99 ${metrics.responseTimes.p99}ms`);
      }
    }
    
    primaryLog(`Memory: ${memoryMB.rss}MB (RSS), ${memoryMB.heapUsed}MB / ${memoryMB.heapTotal}MB (Heap)`);
    primaryLog(`CPU Usage: ${metrics.cpu.usage.toFixed(2)}%`);
    
    if (Object.keys(metrics.statusCodes).length > 0) {
      primaryLog('Status Codes:');
      Object.entries(metrics.statusCodes)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .forEach(([code, count]) => {
          primaryLog(`  ${code}: ${count}`);
        });
    }
    
    primaryLog('');
    data.lastReport = Date.now();
  }

  function resetMetrics() {
    const now = Date.now();
    data.requestCount = 0;
    data.activeRequests = 0;
    data.errorCount = 0;
    data.responseTimes = [];
    data.responseTimesBucket = Array(100).fill(0);
    data.statusCodes = {};
    data.lastReport = now;
    data.lastReset = now;
    
    primaryLog('🔄 Performance metrics have been reset');
  }

  function checkThresholds() {
    const memUsedPercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
    const errorRate = metrics.requestCount ? (metrics.errorCount / metrics.requestCount) * 100 : 0;
    const avgResponseTime = metrics.responseTimes.avg;

    if (metrics.cpu.usage > config.thresholds.cpu && !alarmStatus.cpu) {
      alarmStatus.cpu = true;
      emitter.emit('alarm', 'cpu', `High CPU usage: ${metrics.cpu.usage.toFixed(2)}%`);
    } else if (metrics.cpu.usage <= config.thresholds.cpu && alarmStatus.cpu) {
      alarmStatus.cpu = false;
      emitter.emit('alarm-clear', 'cpu', `CPU usage returned to normal: ${metrics.cpu.usage.toFixed(2)}%`);
    }

    if (memUsedPercent > config.thresholds.memory && !alarmStatus.memory) {
      alarmStatus.memory = true;
      emitter.emit('alarm', 'memory', `High memory usage: ${memUsedPercent.toFixed(2)}%`);
    } else if (memUsedPercent <= config.thresholds.memory && alarmStatus.memory) {
      alarmStatus.memory = false;
      emitter.emit('alarm-clear', 'memory', `Memory usage returned to normal: ${memUsedPercent.toFixed(2)}%`);
    }

    if (avgResponseTime > config.thresholds.responseTime && !alarmStatus.responseTime) {
      alarmStatus.responseTime = true;
      emitter.emit('alarm', 'responseTime', `High response time: ${avgResponseTime.toFixed(2)}ms`);
    } else if (avgResponseTime <= config.thresholds.responseTime && alarmStatus.responseTime) {
      alarmStatus.responseTime = false;
      emitter.emit('alarm-clear', 'responseTime', `Response time returned to normal: ${avgResponseTime.toFixed(2)}ms`);
    }

    if (errorRate > config.thresholds.errorRate && !alarmStatus.errorRate) {
      alarmStatus.errorRate = true;
      emitter.emit('alarm', 'errorRate', `High error rate: ${errorRate.toFixed(2)}%`);
    } else if (errorRate <= config.thresholds.errorRate && alarmStatus.errorRate) {
      alarmStatus.errorRate = false;
      emitter.emit('alarm-clear', 'errorRate', `Error rate returned to normal: ${errorRate.toFixed(2)}%`);
    }
  }

  function formatUptime(uptime: number): string {
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
  }

  function start() {
    const sampleInterval = setInterval(sampleMetrics, config.sampleInterval);
    const reportInterval = setInterval(reportMetrics, config.reportInterval);
    const resetInterval = setInterval(resetMetrics, config.resetInterval);

    return {
      stop: () => {
        clearInterval(sampleInterval);
        clearInterval(reportInterval);
        clearInterval(resetInterval);
      }
    };
  }

  function trackRequest() {
    const startTime = Date.now();
    data.activeRequests++;

    return {
      end: (statusCode: number, error: boolean = false) => {
        const responseTime = Date.now() - startTime;
        data.activeRequests--;
        data.requestCount++;
        
        // Track response time
        data.responseTimes.push(responseTime);
        if (data.responseTimes.length > 1000) {
          data.responseTimes.shift(); // Keep last 1000 response times
        }
        
        // Track status code
        data.statusCodes[statusCode] = (data.statusCodes[statusCode] || 0) + 1;
        
        // Track errors
        if (error || statusCode >= 500) {
          data.errorCount++;
        }
        
        return responseTime;
      }
    };
  }

  function isHealthy(): boolean {
    return !Object.values(alarmStatus).some(status => status);
  }

  function getHealthMetrics() {
    const memUsedPercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
    const errorRate = metrics.requestCount ? (metrics.errorCount / metrics.requestCount) * 100 : 0;
    
    return {
      status: isHealthy() ? 'healthy' : 'unhealthy',
      uptime: metrics.uptime,
      responseTimes: {
        avg: metrics.responseTimes.avg,
        p90: metrics.responseTimes.p90 || null,
        p99: metrics.responseTimes.p99 || null,
      },
      memory: {
        usedMB: Math.round(metrics.memory.heapUsed / 1024 / 1024),
        totalMB: Math.round(metrics.memory.heapTotal / 1024 / 1024),
        percent: memUsedPercent.toFixed(2)
      },
      cpu: metrics.cpu.usage.toFixed(2),
      requests: {
        total: metrics.requestCount,
        active: metrics.activeRequests,
        errors: metrics.errorCount,
        errorRate: errorRate.toFixed(2)
      },
      alerts: Object.entries(alarmStatus)
        .filter(([_, status]) => status)
        .map(([type]) => type)
    };
  }

  const intervals = start();

  return {
    trackRequest,
    getMetrics: () => ({ ...metrics }),
    getMetricsHistory: () => [...metricsHistory],
    getHealthMetrics,
    isHealthy,
    stop: intervals.stop,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
  };
}

function getMonitor(options?: MonitorOptions) {
  if (!monitorInstance) {
    monitorInstance = createMonitor(options);
  }
  return monitorInstance;
}

export { createMonitor, getMonitor };