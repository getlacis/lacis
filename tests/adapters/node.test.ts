import http from 'http';
import https from 'https';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Request, Response } from '@/types';
import { applyRequestMethods, applyResponseMethods } from '@/utils/adapter-base';

const mockLoadRoutes = jest.fn().mockResolvedValue(undefined);
const mockFindRoute = jest.fn();
const mockRunMiddlewares = jest.fn().mockResolvedValue(true);
const mockRegisterMiddlewareConfig = jest.fn();
const mockHasMiddlewares = jest.fn().mockReturnValue(true);

jest.mock('@/core/router', () => ({
  loadRoutes: (...args: any[]) => mockLoadRoutes(...args),
  findRoute: (...args: any[]) => mockFindRoute(...args),
}));

jest.mock('@/core/middleware', () => ({
  runMiddlewares: (...args: any[]) => mockRunMiddlewares(...args),
  registerMiddlewareConfig: (...args: any[]) => mockRegisterMiddlewareConfig(...args),
  hasMiddlewares: () => mockHasMiddlewares(),
}));

import { nodeAdapter } from '@/adapters/node';

const baseConfig = {
  port: 3002,
  isDev: false,
  cluster: { enabled: false },
  monitoring: { enabled: false },
};

type MockServer = { listen: jest.Mock; on: jest.Mock; close: jest.Mock };

function makeMockServer(): MockServer {
  const srv: MockServer = {
    listen: jest.fn((_port: any, cb?: () => void) => { cb?.(); return srv; }),
    on: jest.fn().mockReturnThis(),
    close: jest.fn(),
  };
  return srv;
}

// Creates a req/res pair where `ended` resolves when res.end() is called.
// Does NOT call the real ServerResponse.end() to avoid socket errors in tests.
function makeReqRes(url = '/users', method = 'GET') {
  const req = new IncomingMessage(new Socket()) as Request;
  req.url = url;
  req.method = method;
  applyRequestMethods(req);

  const rawRes = new ServerResponse(req);
  applyResponseMethods(rawRes);

  let _headersSent = false;
  Object.defineProperty(rawRes, 'headersSent', {
    get: () => _headersSent,
    configurable: true,
  });

  let resolveEnd!: () => void;
  const ended = new Promise<void>(resolve => { resolveEnd = resolve; });

  const originalEnd = (rawRes as any).end.bind(rawRes);
  (rawRes as any).end = function (data?: any) {
    _headersSent = true;
    originalEnd(data);
    resolveEnd();
    return this;
  };

  return { req, res: rawRes as unknown as Response, ended };
}

// Starts the adapter and captures the HTTP requestListener.
async function startAndCapture(config = baseConfig as any) {
  let capturedListener: (req: any, res: any) => void = () => {};
  const httpSpy = jest.spyOn(http, 'createServer').mockImplementation((...args: any[]) => {
    capturedListener = typeof args[0] === 'function' ? args[0] : args[1];
    return makeMockServer() as any;
  });
  const handler = nodeAdapter.createHandler('routes');
  await (handler as Function)(config);
  return { listener: capturedListener, httpSpy };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunMiddlewares.mockResolvedValue(true);
  mockHasMiddlewares.mockReturnValue(true);
  mockFindRoute.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// HTTP vs HTTPS
// ---------------------------------------------------------------------------

describe('nodeAdapter — HTTP vs HTTPS', () => {
  let httpSpy: jest.SpyInstance;
  let httpsSpy: jest.SpyInstance;

  beforeEach(() => {
    httpSpy  = jest.spyOn(http,  'createServer').mockReturnValue(makeMockServer() as any);
    httpsSpy = jest.spyOn(https, 'createServer').mockReturnValue(makeMockServer() as any);
  });

  afterEach(() => {
    httpSpy.mockRestore();
    httpsSpy.mockRestore();
  });

  it('uses http.createServer when httpsOptions is not provided', async () => {
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)(baseConfig);
    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(httpsSpy).not.toHaveBeenCalled();
  });

  it('uses https.createServer when httpsOptions is provided', async () => {
    const handler = nodeAdapter.createHandler('routes');
    const httpsOptions = { cert: 'cert', key: 'key' };
    await (handler as Function)({ ...baseConfig, httpsOptions });
    expect(httpsSpy).toHaveBeenCalledTimes(1);
    expect(httpsSpy).toHaveBeenCalledWith(expect.objectContaining(httpsOptions), expect.any(Function));
    expect(httpSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Middleware config registration
// ---------------------------------------------------------------------------

describe('nodeAdapter — middleware config', () => {
  let httpSpy: jest.SpyInstance;

  beforeEach(() => {
    httpSpy = jest.spyOn(http, 'createServer').mockReturnValue(makeMockServer() as any);
  });

  afterEach(() => { httpSpy.mockRestore(); });

  it('calls registerMiddlewareConfig with config.middleware', async () => {
    const beforeFn = jest.fn();
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, middleware: { beforeRequest: beforeFn } });
    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith({ beforeRequest: beforeFn });
  });

  it('passes undefined to registerMiddlewareConfig when no middleware config provided', async () => {
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)(baseConfig);
    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith(undefined);
  });

  it('accepts an array of middleware handlers', async () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)({ ...baseConfig, middleware: { beforeRequest: [fn1, fn2] } });
    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith({ beforeRequest: [fn1, fn2] });
  });
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

describe('nodeAdapter — request handling', () => {
  let httpSpy: jest.SpyInstance;
  let listener: (req: any, res: any) => void;

  beforeEach(async () => {
    const result = await startAndCapture();
    httpSpy = result.httpSpy;
    listener = result.listener;
  });

  afterEach(() => { httpSpy.mockRestore(); });

  it('returns 404 when no route is found', async () => {
    mockFindRoute.mockReturnValue(null);
    const { req, res, ended } = makeReqRes('/users');
    listener(req, res);
    await ended;
    expect(res.statusCode).toBe(404);
  });

  it('calls the route handler when a route is found', async () => {
    const routeHandler = jest.fn().mockImplementation(async (_req: any, res: any) => {
      res.status(200).json({ ok: true });
    });
    mockFindRoute.mockReturnValue({ handler: routeHandler, params: {} });

    const { req, res, ended } = makeReqRes('/users');
    listener(req, res);
    await ended;

    expect(routeHandler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('forwards params to req', async () => {
    let capturedParams: Record<string, string> | undefined;
    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        capturedParams = req.params;
        res.status(200).json({});
      },
      params: { id: '42' },
    });

    const { req, res, ended } = makeReqRes('/users/42');
    listener(req, res);
    await ended;

    expect(capturedParams).toEqual({ id: '42' });
  });

  it('stops request and does not call route handler when beforeRequest returns false', async () => {
    const routeHandler = jest.fn();
    mockFindRoute.mockReturnValue({ handler: routeHandler, params: {} });
    mockRunMiddlewares.mockImplementation(async (type: string, _req: any, res: any) => {
      if (type === 'beforeRequest') {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    });

    const { req, res, ended } = makeReqRes('/users');
    listener(req, res);
    await ended;

    expect(routeHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('calls afterRequest middleware after the route handler', async () => {
    const order: string[] = [];
    let resolveAfter!: () => void;
    const afterRequestCalled = new Promise<void>(r => { resolveAfter = r; });

    mockFindRoute.mockReturnValue({
      handler: async (_req: any, res: any) => {
        order.push('handler');
        res.status(200).json({ ok: true });
      },
      params: {},
    });
    mockRunMiddlewares.mockImplementation(async (type: string) => {
      order.push(type);
      if (type === 'afterRequest') resolveAfter();
      return true;
    });

    const { req, res } = makeReqRes('/users');
    listener(req, res);
    await afterRequestCalled;

    expect(order.indexOf('beforeRequest')).toBeLessThan(order.indexOf('handler'));
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('afterRequest'));
  });

  it('returns 500 and calls onError when route handler throws', async () => {
    mockFindRoute.mockReturnValue({
      handler: async () => { throw new Error('boom'); },
      params: {},
    });

    const { req, res, ended } = makeReqRes('/users');
    listener(req, res);
    await ended;

    expect(res.statusCode).toBe(500);
    expect(mockRunMiddlewares).toHaveBeenCalledWith('onError', expect.anything(), expect.anything());
  });

  it('sets default headers on every response when defaultHeaders is configured', async () => {
    const { listener: l, httpSpy: spy } = await startAndCapture({
      ...baseConfig,
      defaultHeaders: { 'x-powered-by': 'zeno' },
    });

    mockFindRoute.mockReturnValue({
      handler: async (_req: any, res: any) => { res.status(200).json({}); },
      params: {},
    });

    const { req, res, ended } = makeReqRes('/users');
    l(req, res);
    await ended;

    expect(res.getHeader('x-powered-by')).toBe('zeno');
    spy.mockRestore();
  });
});
