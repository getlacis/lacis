import http from 'http';
import { EventEmitter } from 'events';

let mockIsPrimary = true;
let mockIsWorker = false;
const mockClusterWorkers: Record<number, any> = {};
const clusterForkSpy = jest.fn();
const clusterOnSpy = jest.fn();

jest.mock('cluster', () => ({
  get isPrimary() { return mockIsPrimary; },
  get isWorker() { return mockIsWorker; },
  fork: (...args: any[]) => clusterForkSpy(...args),
  get workers() { return mockClusterWorkers; },
  on: (...args: any[]) => clusterOnSpy(...args),
  SCHED_RR: 2,
  get schedulingPolicy() { return undefined; },
}));

const mockLbStart = jest.fn();
const mockLbShutdown = jest.fn((cb?: () => void) => cb?.());
const mockLbGetWorkerStats = jest.fn().mockReturnValue([]);
const mockLbGetActiveWorkerCount = jest.fn().mockReturnValue(0);
const mockCreateLoadBalancer = jest.fn().mockReturnValue({
  start: mockLbStart,
  shutdown: mockLbShutdown,
  getWorkerStats: mockLbGetWorkerStats,
  getActiveWorkerCount: mockLbGetActiveWorkerCount,
});

jest.mock('@/utils/loadBalancer', () => ({
  createLoadBalancer: (...args: any[]) => mockCreateLoadBalancer(...args),
}));

const mockLoadRoutes = jest.fn().mockResolvedValue(undefined);
const mockRegisterCorsConfig = jest.fn();
const mockRegisterMiddlewareConfig = jest.fn();
const mockHasMiddlewares = jest.fn().mockReturnValue(false);
jest.mock('@/core/router', () => ({ loadRoutes: (...a: any[]) => mockLoadRoutes(...a), findRoute: jest.fn() }));
jest.mock('@/core/middleware', () => ({
  hasMiddlewares: () => mockHasMiddlewares(),
  runMiddlewares: jest.fn(),
  registerMiddlewareConfig: (...a: any[]) => mockRegisterMiddlewareConfig(...a),
  registerHooksConfig: jest.fn(),
  hasNotFoundHook: () => false,
  runNotFoundHook: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/core/cors', () => ({ registerCorsConfig: (...a: any[]) => mockRegisterCorsConfig(...a) }));
jest.mock('@/utils/logs', () => ({ primaryLog: jest.fn() }));
jest.mock('@/utils/monitor', () => ({ getMonitor: jest.fn() }));

function makeMockHttpServer() {
  const srv = new EventEmitter() as any;
  srv.listen = jest.fn((_port: any, cb?: () => void) => { cb?.(); return srv; });
  srv.close = jest.fn();
  return srv;
}

const mockHttpCreateServer = jest.fn();
jest.spyOn(http, 'createServer').mockImplementation((...args: any[]) => mockHttpCreateServer(...args));

import { nodeAdapter } from '@/adapters/node';

const baseConfig = {
  port: 3099,
  isDev: false,
  monitoring: { enabled: false },
};

beforeEach(() => {
  mockIsPrimary = true;
  mockIsWorker = false;
  jest.clearAllMocks();

  mockCreateLoadBalancer.mockReturnValue({
    start: mockLbStart,
    shutdown: mockLbShutdown,
    getWorkerStats: mockLbGetWorkerStats,
    getActiveWorkerCount: mockLbGetActiveWorkerCount,
  });
  mockHttpCreateServer.mockReturnValue(makeMockHttpServer());
  mockLoadRoutes.mockResolvedValue(undefined);
});


describe('primary — cluster enabled', () => {
  it('creates a load balancer and starts it with the configured worker count', async () => {
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: true, workers: 3 } });

    expect(mockCreateLoadBalancer).toHaveBeenCalled();
    expect(mockLbStart).toHaveBeenCalledWith(3);
  });

  it('does not create an HTTP server on the primary', async () => {
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: true, workers: 2 } });

    expect(mockHttpCreateServer).not.toHaveBeenCalled();
  });

  it('close() delegates to lb.shutdown()', async () => {
    const handler = nodeAdapter.createHandler('routes');
    const result = await (handler as Function)({ ...baseConfig, cluster: { enabled: true, workers: 2 } }) as any;
    const cb = jest.fn();
    result.close(cb);

    expect(mockLbShutdown).toHaveBeenCalledWith(cb);
  });
});


describe('worker — cluster enabled', () => {
  beforeEach(() => {
    mockIsPrimary = false;
    mockIsWorker = true;
  });

  it('calls server.listen() on the worker port', async () => {
    const mockServer = makeMockHttpServer();
    mockHttpCreateServer.mockReturnValue(mockServer);

    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: true, workers: 2 } });

    expect(mockServer.listen).toHaveBeenCalledWith(3099, expect.any(Function));
  });

  it('calls lb.start() for stats reporting', async () => {
    mockHttpCreateServer.mockReturnValue(makeMockHttpServer());

    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: true, workers: 2 } });

    expect(mockLbStart).toHaveBeenCalled();
  });
});


describe('non-cluster mode', () => {
  it('does not create a load balancer', async () => {
    const mockServer = makeMockHttpServer();
    mockHttpCreateServer.mockReturnValue(mockServer);

    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: false } });

    expect(mockCreateLoadBalancer).not.toHaveBeenCalled();
  });

  it('calls server.listen() directly', async () => {
    const mockServer = makeMockHttpServer();
    mockHttpCreateServer.mockReturnValue(mockServer);

    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, cluster: { enabled: false } });

    expect(mockServer.listen).toHaveBeenCalledWith(3099, expect.any(Function));
  });
});
