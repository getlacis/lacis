const mockBunStop = jest.fn();
const mockBunServe = jest.fn().mockReturnValue({ stop: mockBunStop });
(global as any).Bun = { serve: mockBunServe };

const mockLoadRoutes = jest.fn().mockResolvedValue(undefined);
const mockFindRoute = jest.fn();
const mockRunMiddlewares = jest.fn().mockResolvedValue(true);
const mockRegisterMiddlewareConfig = jest.fn();
const mockHasMiddlewares = jest.fn().mockReturnValue(false);

jest.mock('@/core/router', () => ({
  loadRoutes: (...args: any[]) => mockLoadRoutes(...args),
  findRoute: (...args: any[]) => mockFindRoute(...args),
}));

jest.mock('@/core/middleware', () => ({
  runMiddlewares: (...args: any[]) => mockRunMiddlewares(...args),
  registerMiddlewareConfig: (...args: any[]) => mockRegisterMiddlewareConfig(...args),
  hasMiddlewares: () => mockHasMiddlewares(),
}));

jest.mock('@/utils/logs', () => ({ primaryLog: jest.fn() }));

import { bunAdapter } from '@/adapters/bun';
import type { Request as LacisRequest, Response as LacisResponse } from '@/types';

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
}

async function readStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString();
}

async function startAndCaptureFetch(config: Record<string, unknown> = {}) {
  let capturedFetch!: (req: Request) => Promise<Response>;
  mockBunServe.mockImplementation(({ fetch }: any) => {
    capturedFetch = fetch;
    return { stop: mockBunStop };
  });
  const factory = bunAdapter.createHandler('routes');
  await (factory as Function)(config);
  return capturedFetch;
}

const makeRoute = (handler: Function) => ({ handler, params: {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadRoutes.mockResolvedValue(undefined);
  mockRunMiddlewares.mockResolvedValue(true);
  mockHasMiddlewares.mockReturnValue(false);
  mockFindRoute.mockReturnValue(null);
  mockBunServe.mockReturnValue({ stop: mockBunStop });
});

describe('bunAdapter.createHandler()', () => {
  it('throws when passed a ServerlessConfig instead of a routesDir string', () => {
    expect(() => bunAdapter.createHandler({ routes: [] })).toThrow(
      'bunAdapter requires a routesDir string',
    );
  });

  it('calls loadRoutes with the given directory', async () => {
    const factory = bunAdapter.createHandler('my-routes');
    await (factory as Function)({});
    expect(mockLoadRoutes).toHaveBeenCalledWith('my-routes');
  });

  it('passes config.middleware to registerMiddlewareConfig', async () => {
    const mw = { beforeRequest: jest.fn() };
    const factory = bunAdapter.createHandler('routes');
    await (factory as Function)({ middleware: mw });
    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith(mw);
  });

  it('starts Bun.serve on the given port', async () => {
    const factory = bunAdapter.createHandler('routes');
    await (factory as Function)({ port: 4000 });
    expect(mockBunServe).toHaveBeenCalledWith(expect.objectContaining({ port: 4000 }));
  });

  it('returns a close() that stops the server', async () => {
    const factory = bunAdapter.createHandler('routes');
    const { close } = await (factory as Function)({});
    close();
    expect(mockBunStop).toHaveBeenCalled();
  });
});

describe('bunAdapter — routing', () => {
  it('returns 404 when no route matches', async () => {
    const fetch = await startAndCaptureFetch();
    const res = await fetch(makeRequest('/missing'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Route not found' });
  });

  it('returns the route error status when the matched route carries an error', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue({ error: 'Method Not Allowed', status: 405 });
    const res = await fetch(makeRequest('/users', 'PATCH'));
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: 'Method Not Allowed' });
  });

  it('calls the route handler and returns its response', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => res.status(201).json({ created: true })),
    );
    const res = await fetch(makeRequest('/users', 'POST'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
  });

  it('forwards route params to req.params', async () => {
    const fetch = await startAndCaptureFetch();
    let captured: Record<string, string> | undefined;
    mockFindRoute.mockReturnValue({
      handler: async (req: LacisRequest, res: LacisResponse) => { captured = req.params; res.status(200).json({}); },
      params: { id: '42' },
    });
    await fetch(makeRequest('/users/42'));
    expect(captured).toEqual({ id: '42' });
  });

  it('applies defaultHeaders to every response', async () => {
    const fetch = await startAndCaptureFetch({ defaultHeaders: { 'x-powered-by': 'lacis' } });
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => res.status(200).json({})),
    );
    const res = await fetch(makeRequest('/'));
    expect(res.headers.get('x-powered-by')).toBe('lacis');
  });

  it('returns 500 when the route handler throws', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(makeRoute(async () => { throw new Error('boom'); }));
    const res = await fetch(makeRequest('/'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });

  it('auto-ends the response when the handler returns without calling res.end()', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => { res.statusCode = 204; }),
    );
    const res = await fetch(makeRequest('/'));
    expect(res.status).toBe(204);
  });
});

describe('bunAdapter — middleware', () => {
  beforeEach(() => mockHasMiddlewares.mockReturnValue(true));

  it('stops the request and skips the handler when beforeRequest returns false', async () => {
    const fetch = await startAndCaptureFetch();
    const handler = jest.fn();
    mockFindRoute.mockReturnValue(makeRoute(handler));
    mockRunMiddlewares.mockImplementation(async (type: string, _req: LacisRequest, res: LacisResponse) => {
      if (type === 'beforeRequest') { res.status(403).json({ error: 'forbidden' }); return false; }
      return true;
    });
    const res = await fetch(makeRequest('/'));
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('calls afterRequest after the handler', async () => {
    const fetch = await startAndCaptureFetch();
    const order: string[] = [];
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => { order.push('handler'); res.status(200).json({}); }),
    );
    mockRunMiddlewares.mockImplementation(async (type: string) => { order.push(type); return true; });
    await fetch(makeRequest('/'));
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('afterRequest'));
  });

  it('calls onError middleware when no route is found', async () => {
    const fetch = await startAndCaptureFetch();
    await fetch(makeRequest('/missing'));
    expect(mockRunMiddlewares).toHaveBeenCalledWith('onError', expect.anything(), expect.anything());
  });

  it('calls onError middleware when the route carries an error', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue({ error: 'forbidden', status: 403 });
    await fetch(makeRequest('/'));
    expect(mockRunMiddlewares).toHaveBeenCalledWith('onError', expect.anything(), expect.anything());
  });

  it('calls onError with { error } when route handler throws', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(makeRoute(async () => { throw new Error('boom'); }));
    const res = await fetch(makeRequest('/'));
    expect(res.status).toBe(500);
    expect(mockRunMiddlewares).toHaveBeenCalledWith('onError', expect.anything(), expect.anything(), { error: expect.any(Error) });
  });

  it('does not send 500 fallback if onError already responded', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(makeRoute(async () => { throw new Error('boom'); }));
    mockRunMiddlewares.mockImplementation(async (type: string, _req: LacisRequest, res: LacisResponse) => {
      if (type === 'onError') res.status(503).json({ error: 'custom' });
      return true;
    });
    const result = await fetch(makeRequest('/'));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: 'custom' });
  });
});

describe('bunAdapter — SSE', () => {
  it('returns a streaming response when initSSE is called synchronously', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => {
        res.initSSE({ timeout: 60000 });
        res.sseSend('hello');
        res.sseClose();
      }),
    );
    const res = await fetch(makeRequest('/sse'));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await readStream(res.body!);
    expect(text).toContain('data: hello');
  });

  it('streams multiple events in order', async () => {
    const fetch = await startAndCaptureFetch();
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req: LacisRequest, res: LacisResponse) => {
        res.initSSE({ timeout: 60000 });
        res.sseEvent('tick', { n: 1 });
        res.sseEvent('tick', { n: 2 });
        res.sseClose();
      }),
    );
    const res = await fetch(makeRequest('/sse'));
    const text = await readStream(res.body!);
    expect(text.indexOf('"n":1')).toBeLessThan(text.indexOf('"n":2'));
  });

  // setTimeout is a macrotask — by the time it fires, _closeSseWindow() has already run
  it('throws if initSSE is called after the detection window closes', async () => {
    const fetch = await startAndCaptureFetch();
    let caughtError: unknown = null;
    mockFindRoute.mockReturnValue({
      handler: (_req: LacisRequest, res: LacisResponse) =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            try { res.initSSE(); } catch (e) { caughtError = e as Error; }
            res.end();
            resolve();
          }, 0);
        }),
      params: {},
    });
    await fetch(makeRequest('/sse'));
    expect((caughtError as Error)?.message).toContain('[lacis/bun] initSSE()');
  });
});
