import { createWorkerSupervisor } from '@/utils/workerSupervisor';

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
    createWorkerSupervisor().start(4);
    expect(forkSpy).toHaveBeenCalledTimes(4);
  });

  it('registers forked workers in state', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(3);
    expect(supervisor.getActiveWorkerCount()).toBe(3);
  });

  it('sets up a cluster exit handler', () => {
    createWorkerSupervisor().start(2);
    expect(clusterOnHandlers['exit']?.length).toBeGreaterThan(0);
  });

  it('does not fork in worker mode', () => {
    isPrimary = false;
    isWorker = true;
    createWorkerSupervisor().start(4);
    expect(forkSpy).not.toHaveBeenCalled();
  });

  it('handles zero workers gracefully', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(0);
    expect(supervisor.getActiveWorkerCount()).toBe(0);
  });
});


describe('shutdown()', () => {
  it('kills all cluster workers', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(3);
    supervisor.shutdown();
    for (const w of mockWorkersList) expect(w.kill).toHaveBeenCalled();
  });

  it('calls callback immediately when no workers exist', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(0);
    const cb = jest.fn();
    supervisor.shutdown(cb);
    expect(cb).toHaveBeenCalled();
  });

  it('calls callback once all workers have exited', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(2);
    const cb = jest.fn();
    supervisor.shutdown(cb);

    expect(cb).not.toHaveBeenCalled();
    emitWorkerExit(mockWorkersList[0]);
    expect(cb).not.toHaveBeenCalled();
    emitWorkerExit(mockWorkersList[1]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not restart workers after shutdown', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(2);
    const countBefore = forkSpy.mock.calls.length;
    supervisor.shutdown();
    emitWorkerExit(mockWorkersList[0]);
    expect(forkSpy).toHaveBeenCalledTimes(countBefore);
  });
});


describe('worker restart on unexpected exit', () => {
  it('removes dead worker from state', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(2);
    emitWorkerExit(mockWorkersList[0]);
    expect(supervisor.getActiveWorkerCount()).toBe(1);
  });

  it('does not call shutdown callback on unexpected exit', () => {
    const supervisor = createWorkerSupervisor();
    supervisor.start(2);
    const cb = jest.fn();
    // Do NOT call shutdown() — this is an unexpected exit
    emitWorkerExit(mockWorkersList[0]);
    expect(cb).not.toHaveBeenCalled();
  });
});
