import {
  addMiddleware,
  addPathMiddleware,
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

describe('addPathMiddleware + collectMiddleware', () => {
  it('includes path middleware for an exact URL match', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/api');
    expect(collected.beforeRequest).toContain(fn);
  });

  it('includes path middleware for a child URL', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/api/users/42');
    expect(collected.beforeRequest).toContain(fn);
  });

  it('does not include path middleware for an unrelated URL', () => {
    const fn = jest.fn();
    addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/other');
    expect(collected.beforeRequest).not.toContain(fn);
  });

  it('includes root "/" middleware for all paths', () => {
    const fn = jest.fn();
    addPathMiddleware('/', 'beforeRequest', fn);

    expect(collectMiddleware('/anything').beforeRequest).toContain(fn);
    expect(collectMiddleware('/deep/nested/path').beforeRequest).toContain(fn);
  });

  it('executes path middleware in the correct order (global → path hierarchy)', async () => {
    const order: number[] = [];
    const globalFn = jest.fn().mockImplementation(() => { order.push(1); });
    const apiFn = jest.fn().mockImplementation(() => { order.push(2); });
    const usersPath = jest.fn().mockImplementation(() => { order.push(3); });

    addMiddleware('beforeRequest', globalFn);
    addPathMiddleware('/api', 'beforeRequest', apiFn);
    addPathMiddleware('/api/users', 'beforeRequest', usersPath);

    await runMiddlewares('beforeRequest', makeReq('/api/users'), makeRes());
    expect(order).toEqual([1, 2, 3]);
  });
});
