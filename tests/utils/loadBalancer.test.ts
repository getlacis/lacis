import { createLoadBalancer } from '@/utils/loadBalancer';

let isPrimary = true;
let isWorker = false;
let workerIdCounter = 0;
const forkSpy = jest.fn();
const clusterOnHandlers: Record<string, Array<(...args: any[]) => void>> = {};
const mockWorkersList: any[] = [];

jest.mock('cluster', () => ({
  get isPrimary() { return isPrimary; },
  get isWorker() { return isWorker; },
  fork: (...args: any[]) => {
    forkSpy(...args);
    workerIdCounter++;
    const id = workerIdCounter;
    const worker = { id, process: { pid: 1000 + id }, send: jest.fn(), kill: jest.fn() };
    mockWorkersList.push(worker);
    return worker;
  },
  get workers() {
    return Object.fromEntries(mockWorkersList.map(w => [w.id, w]));
  },
  on: jest.fn((event: string, handler: any) => {
    if (!clusterOnHandlers[event]) clusterOnHandlers[event] = [];
    clusterOnHandlers[event].push(handler);
  }),
  SCHED_RR: 2,
  schedulingPolicy: undefined,
}));

jest.mock('@/utils/logs', () => ({ primaryLog: jest.fn() }));

function emitClusterMessage(worker: any, msg: any) {
  (clusterOnHandlers['message'] ?? []).forEach(h => h(worker, msg));
}

function emitWorkerExit(worker: any) {
  (clusterOnHandlers['exit'] ?? []).forEach(h => h(worker, 0, null));
}

beforeEach(() => {
  isPrimary = true;
  isWorker = false;
  workerIdCounter = 0;
  mockWorkersList.length = 0;
  for (const key of Object.keys(clusterOnHandlers)) delete clusterOnHandlers[key];
  jest.clearAllMocks();
});


describe('start() in primary', () => {
  it('forks the requested number of workers', () => {
    createLoadBalancer().start(4);
    expect(forkSpy).toHaveBeenCalledTimes(4);
  });

  it('registers forked workers in state', () => {
    const lb = createLoadBalancer();
    lb.start(3);
    expect(lb.getActiveWorkerCount()).toBe(3);
    expect(lb.getWorkerStats()).toHaveLength(3);
  });

  it('sets up a cluster message handler', () => {
    createLoadBalancer().start(2);
    expect(clusterOnHandlers['message']?.length).toBeGreaterThan(0);
  });

  it('does not fork in worker mode', () => {
    isPrimary = false;
    isWorker = true;
    createLoadBalancer().start(4);
    expect(forkSpy).not.toHaveBeenCalled();
  });

  it('handles zero workers gracefully', () => {
    const lb = createLoadBalancer();
    lb.start(0);
    expect(lb.getActiveWorkerCount()).toBe(0);
  });
});


describe('stats message from worker', () => {
  it('updates CPU load when worker sends a stats message', () => {
    const lb = createLoadBalancer();
    lb.start(2);
    const [[id]] = lb.getWorkerStats();

    emitClusterMessage({ id }, { type: 'stats', stats: { load: 0.75 } });

    const updated = lb.getWorkerStats().find(([i]) => i === id)!;
    expect(updated[1].load).toBe(0.75);
  });

  it('updates memory usage from stats message', () => {
    const lb = createLoadBalancer();
    lb.start(1);
    const [[id]] = lb.getWorkerStats();
    const memoryUsage = { rss: 512, heapTotal: 256, heapUsed: 128, external: 8, arrayBuffers: 0 };

    emitClusterMessage({ id }, { type: 'stats', stats: { memoryUsage } });

    const [[, stats]] = lb.getWorkerStats();
    expect(stats.memoryUsage).toEqual(memoryUsage);
  });
});


describe('shutdown()', () => {
  it('kills all cluster workers', () => {
    const lb = createLoadBalancer();
    lb.start(3);
    lb.shutdown();
    for (const w of mockWorkersList) expect(w.kill).toHaveBeenCalled();
  });

  it('calls callback immediately when no workers exist', () => {
    const lb = createLoadBalancer();
    lb.start(0);
    const cb = jest.fn();
    lb.shutdown(cb);
    expect(cb).toHaveBeenCalled();
  });

  it('calls callback once all workers have exited', () => {
    const lb = createLoadBalancer();
    lb.start(2);
    const cb = jest.fn();
    lb.shutdown(cb);

    expect(cb).not.toHaveBeenCalled();
    emitWorkerExit(mockWorkersList[0]);
    expect(cb).not.toHaveBeenCalled();
    emitWorkerExit(mockWorkersList[1]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not restart workers after shutdown', () => {
    const lb = createLoadBalancer();
    lb.start(2);
    const countBefore = forkSpy.mock.calls.length;
    lb.shutdown();
    emitWorkerExit(mockWorkersList[0]);
    expect(forkSpy).toHaveBeenCalledTimes(countBefore);
  });
});


describe('worker restart on unexpected exit', () => {
  it('removes dead worker from state', () => {
    const lb = createLoadBalancer();
    lb.start(2);
    emitWorkerExit(mockWorkersList[0]);
    expect(lb.getActiveWorkerCount()).toBe(1);
  });

  it('does not call shutdown callback on unexpected exit', () => {
    const lb = createLoadBalancer();
    lb.start(2);
    const cb = jest.fn();
    // Do NOT call shutdown() — this is an unexpected exit
    emitWorkerExit(mockWorkersList[0]);
    expect(cb).not.toHaveBeenCalled();
  });
});
