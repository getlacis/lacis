import type { VercelRequest, VercelResponse } from '@/types';
import type { Request, Response } from '@/types';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

const mockRegisterRoutes = jest.fn();
const mockFindRoute = jest.fn();
const mockIsRouteError = jest.fn((obj: any) => 'error' in obj);
const mockRunMiddlewares = jest.fn().mockResolvedValue(true);
const mockRegisterMiddlewareConfig = jest.fn();
const mockRegisterHooksConfig = jest.fn();
const mockHasMiddlewares = jest.fn().mockReturnValue(true);
const mockHasNotFoundHook = jest.fn().mockReturnValue(false);
const mockRunNotFoundHook = jest.fn().mockResolvedValue(undefined);

jest.mock('@/core/router', () => ({
  registerRoutes: (...args: any[]) => mockRegisterRoutes(...args),
  findRoute: (...args: any[]) => mockFindRoute(...args),
  isRouteError: (obj: any) => mockIsRouteError(obj),
}));

const mockRegisterMiddlewares = jest.fn();

jest.mock('@/core/middleware', () => ({
  runMiddlewares: (...args: any[]) => mockRunMiddlewares(...args),
  registerMiddlewareConfig: (...args: any[]) => mockRegisterMiddlewareConfig(...args),
  registerMiddlewares: (...args: any[]) => mockRegisterMiddlewares(...args),
  registerHooksConfig: (...args: any[]) => mockRegisterHooksConfig(...args),
  hasMiddlewares: () => mockHasMiddlewares(),
  hasNotFoundHook: () => mockHasNotFoundHook(),
  runNotFoundHook: (...args: any[]) => mockRunNotFoundHook(...args),
}));

import { vercelAdapter } from '@/adapters/vercel';

function makeVercelReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    url: '/users',
    method: 'GET',
    headers: {},
    cookies: {},
    ...overrides,
  };
}

function makeVercelRes(): { res: VercelResponse; statusCode: () => number; body: () => string; headers: () => Record<string, string> } {
  const rawReq = new IncomingMessage(new Socket());
  const rawRes = new ServerResponse(rawReq);

  let _body = '';
  let _headers: Record<string, string> = {};

  rawRes.end = function (data?: any) {
    if (data) _body = typeof data === 'string' ? data : data.toString();
    return this;
  };
  rawRes.setHeader = function (name: string, value: any) {
    _headers[name.toLowerCase()] = String(value);
    return this;
  };

  const res = rawRes as unknown as VercelResponse;

  return {
    res,
    statusCode: () => rawRes.statusCode,
    body: () => _body,
    headers: () => _headers,
  };
}

function makeRoute(handler: (req: Request, res: Response) => Promise<void> = async (_req, res) => {
  res.status(200).json({ ok: true });
}) {
  return { handler, params: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsRouteError.mockImplementation((obj: any) => 'error' in obj);
  mockRunMiddlewares.mockResolvedValue(true);
  mockHasMiddlewares.mockReturnValue(true);
});

describe('vercelAdapter.createHandler()', () => {
  it('throws when passed a string instead of ServerlessConfig', () => {
    expect(() => vercelAdapter.createHandler('routes')).toThrow('ServerlessConfig');
  });
});

describe('vercelAdapter handler', () => {
  it('registers routes exactly once across multiple calls (lazy init)', async () => {
    const routes = [{ path: '/users', handlers: { GET: async () => {} } }];
    const handler = vercelAdapter.createHandler({ routes }) as Function;
    mockFindRoute.mockReturnValue(makeRoute());

    const { res } = makeVercelRes();
    await handler(makeVercelReq(), res);
    await handler(makeVercelReq(), res);
    await handler(makeVercelReq(), res);

    expect(mockRegisterRoutes).toHaveBeenCalledTimes(1);
    expect(mockRegisterRoutes).toHaveBeenCalledWith(routes);
  });

  it('returns 404 when route is not found', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(null);

    const { res, statusCode, body } = makeVercelRes();
    await handler(makeVercelReq({ url: '/not-found' }), res);

    expect(statusCode()).toBe(404);
    expect(JSON.parse(body())).toEqual({ error: 'Route not found' });
  });

  it('returns 405 when method is not allowed', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({ error: 'Method Not Allowed', status: 405 });
    mockIsRouteError.mockReturnValue(true);

    const { res, statusCode } = makeVercelRes();
    await handler(makeVercelReq({ method: 'DELETE' }), res);

    expect(statusCode()).toBe(405);
  });

  it('calls the route handler and returns its response', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(makeRoute(async (_req, res) => {
      res.status(201).json({ id: 42 });
    }));

    const { res, statusCode, body } = makeVercelRes();
    await handler(makeVercelReq({ method: 'POST' }), res);

    expect(statusCode()).toBe(201);
    expect(JSON.parse(body())).toEqual({ id: 42 });
  });

  it('forwards route params to the request', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    let capturedParams: Record<string, string> | undefined;

    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        capturedParams = req.params;
        res.status(200).json({});
      },
      params: { id: '7' },
    });

    const { res } = makeVercelRes();
    await handler(makeVercelReq({ url: '/users/7' }), res);

    expect(capturedParams).toEqual({ id: '7' });
  });

  it('runs beforeRequest middleware and stops if it returns false', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    const routeHandler = jest.fn();
    mockFindRoute.mockReturnValue({ handler: routeHandler, params: {} });
    mockRunMiddlewares.mockImplementation(async (type: string) =>
      type === 'beforeRequest' ? false : true
    );

    const { res } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(routeHandler).not.toHaveBeenCalled();
  });

  it('registers config middleware via registerMiddlewareConfig', async () => {
    const afterFn = jest.fn();
    const routes = [{ path: '/users', handlers: {} }];
    const handler = vercelAdapter.createHandler({ routes, middleware: { afterRequest: afterFn } }) as Function;
    mockFindRoute.mockReturnValue(makeRoute());

    const { res } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith({ afterRequest: afterFn });
  });

  it('returns 500 when the route handler throws', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({
      handler: async () => { throw new Error('boom'); },
      params: {},
    });

    const { res, statusCode, body } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(statusCode()).toBe(500);
    expect(JSON.parse(body())).toEqual({ error: 'Internal server error' });
  });

  it('accepts an array of middleware handlers', async () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    const routes = [{ path: '/users', handlers: {} }];
    const handler = vercelAdapter.createHandler({ routes, middleware: { beforeRequest: [fn1, fn2] } }) as Function;
    mockFindRoute.mockReturnValue(makeRoute());

    const { res } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith({ beforeRequest: [fn1, fn2] });
  });

  it('calls afterRequest middleware after the route handler', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    const order: string[] = [];

    mockFindRoute.mockReturnValue({
      handler: async (_req: any, res: any) => {
        order.push('handler');
        res.status(200).json({ ok: true });
      },
      params: {},
    });
    mockRunMiddlewares.mockImplementation(async (type: string) => {
      order.push(type);
      return true;
    });

    const { res } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(order.indexOf('beforeRequest')).toBeLessThan(order.indexOf('handler'));
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('afterRequest'));
  });

  it('calls onError middleware when route handler throws', async () => {
    const handler = vercelAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({
      handler: async () => { throw new Error('fail'); },
      params: {},
    });

    const { res, statusCode } = makeVercelRes();
    await handler(makeVercelReq(), res);

    expect(statusCode()).toBe(500);
    expect(mockRunMiddlewares).toHaveBeenCalledWith(
      'onError',
      expect.anything(),
      expect.anything(),
      { error: expect.objectContaining({ code: 500 }) }
    );
  });
});
