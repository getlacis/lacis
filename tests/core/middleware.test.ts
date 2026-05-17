import {
  addMiddleware,
  addPathMiddleware,
  addExactPathMiddleware,
  runMiddlewares,
  collectMiddleware,
  resetMiddlewares,
} from '@/core/middleware';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Request, Response } from '@/types';

function makeReq(url = '/'): Request {
  const req = new IncomingMessage(new Socket()) as Request;
  req.url = url;
  return req;
}

function makeRes(): Response {
  const req = new IncomingMessage(new Socket());
  return new ServerResponse(req) as unknown as Response;
}

afterEach(() => resetMiddlewares());

describe('addMiddleware + runMiddlewares', () => {
  it('runs a beforeRequest middleware', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    addMiddleware('beforeRequest', fn);

    await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns true when all middlewares pass', async () => {
    const fn = jest.fn().mockResolvedValue(true);
    addMiddleware('afterRequest', fn);

    const result = await runMiddlewares('afterRequest', makeReq(), makeRes());
    expect(result).toBe(true);
  });

  it('halts chain and returns false when a middleware returns false', async () => {
    const fn1 = jest.fn().mockReturnValue(false);
    const fn2 = jest.fn();
    addMiddleware('beforeRequest', fn1);
    addMiddleware('beforeRequest', fn2);

    const result = await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(result).toBe(false);
    expect(fn2).not.toHaveBeenCalled();
  });

  it('triggers onError middleware when beforeRequest throws', async () => {
    const errorFn = jest.fn().mockRejectedValue(new Error('boom'));
    const onErrorFn = jest.fn();
    addMiddleware('beforeRequest', errorFn);
    addMiddleware('onError', onErrorFn);

    await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(onErrorFn).toHaveBeenCalled();
  });

  it('remove() cleanly unregisters the middleware', async () => {
    const fn = jest.fn();
    const { remove } = addMiddleware('beforeRequest', fn);
    remove();

    await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('addPathMiddleware (cascade via +middleware.global.ts)', () => {
  it('includes middleware for an exact URL match', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/api').beforeRequest).toContain(fn);
  });

  it('includes middleware for child URLs', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/api/users/42').beforeRequest).toContain(fn);
  });

  it('does not include middleware for unrelated URLs', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/other').beforeRequest).not.toContain(fn);
  });

  it('includes root "/" middleware for all paths', () => {
    const fn = jest.fn();
    addPathMiddleware('/', 'beforeRequest', fn);
    expect(collectMiddleware('/anything').beforeRequest).toContain(fn);
    expect(collectMiddleware('/deep/nested/path').beforeRequest).toContain(fn);
  });

  it('executes in order: global → path hierarchy', async () => {
    const order: number[] = [];
    addMiddleware('beforeRequest', jest.fn().mockImplementation(() => { order.push(1); }));
    addPathMiddleware('/api', 'beforeRequest', jest.fn().mockImplementation(() => { order.push(2); }));
    addPathMiddleware('/api/users', 'beforeRequest', jest.fn().mockImplementation(() => { order.push(3); }));

    await runMiddlewares('beforeRequest', makeReq('/api/users'), makeRes());
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('addExactPathMiddleware (exact via +middleware.ts)', () => {
  it('includes middleware for the exact URL', () => {
    const fn = jest.fn();
    addExactPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/api').beforeRequest).toContain(fn);
  });

  it('does not include middleware for child URLs', () => {
    const fn = jest.fn();
    addExactPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/api/users').beforeRequest).not.toContain(fn);
    expect(collectMiddleware('/api/users/42').beforeRequest).not.toContain(fn);
  });

  it('does not include middleware for unrelated URLs', () => {
    const fn = jest.fn();
    addExactPathMiddleware('/api', 'beforeRequest', fn);
    expect(collectMiddleware('/other').beforeRequest).not.toContain(fn);
  });

  it('root "/" exact middleware only runs for "/"', () => {
    const fn = jest.fn();
    addExactPathMiddleware('/', 'beforeRequest', fn);
    expect(collectMiddleware('/').beforeRequest).toContain(fn);
    expect(collectMiddleware('/api').beforeRequest).not.toContain(fn);
  });

  it('cascade and exact can coexist on the same path', () => {
    const cascadeFn = jest.fn();
    const exactFn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', cascadeFn);
    addExactPathMiddleware('/api', 'beforeRequest', exactFn);

    // Both run on /api
    const atApi = collectMiddleware('/api');
    expect(atApi.beforeRequest).toContain(cascadeFn);
    expect(atApi.beforeRequest).toContain(exactFn);

    // Only cascade runs on /api/users
    const atChild = collectMiddleware('/api/users');
    expect(atChild.beforeRequest).toContain(cascadeFn);
    expect(atChild.beforeRequest).not.toContain(exactFn);
  });

  it('remove() unregisters the exact middleware', async () => {
    const fn = jest.fn();
    const { remove } = addExactPathMiddleware('/api', 'beforeRequest', fn);
    remove();
    expect(collectMiddleware('/api').beforeRequest).not.toContain(fn);
  });
});
