import {
  addMiddleware,
  addPathMiddleware,
  runMiddlewares,
  collectMiddleware,
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

describe('addMiddleware + runMiddlewares', () => {
  it('runs a beforeRequest middleware', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const { remove } = addMiddleware('beforeRequest', fn);

    await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(fn).toHaveBeenCalledTimes(1);

    remove();
  });

  it('returns true when all middlewares pass', async () => {
    const fn = jest.fn().mockResolvedValue(true);
    const { remove } = addMiddleware('afterRequest', fn);

    const result = await runMiddlewares('afterRequest', makeReq(), makeRes());
    expect(result).toBe(true);

    remove();
  });

  it('halts chain and returns false when a middleware returns false', async () => {
    const fn1 = jest.fn().mockReturnValue(false);
    const fn2 = jest.fn();
    const r1 = addMiddleware('beforeRequest', fn1);
    const r2 = addMiddleware('beforeRequest', fn2);

    const result = await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(result).toBe(false);
    expect(fn2).not.toHaveBeenCalled();

    r1.remove();
    r2.remove();
  });

  it('triggers onError middleware when beforeRequest throws', async () => {
    const errorFn = jest.fn().mockRejectedValue(new Error('boom'));
    const onErrorFn = jest.fn();
    const r1 = addMiddleware('beforeRequest', errorFn);
    const r2 = addMiddleware('onError', onErrorFn);

    await runMiddlewares('beforeRequest', makeReq(), makeRes());
    expect(onErrorFn).toHaveBeenCalled();

    r1.remove();
    r2.remove();
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
    const { remove } = addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/api');
    expect(collected.beforeRequest).toContain(fn);

    remove();
  });

  it('includes path middleware for a child URL', () => {
    const fn = jest.fn();
    const { remove } = addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/api/users/42');
    expect(collected.beforeRequest).toContain(fn);

    remove();
  });

  it('does not include path middleware for an unrelated URL', () => {
    const fn = jest.fn();
    const { remove } = addPathMiddleware('/api', 'beforeRequest', fn);

    const collected = collectMiddleware('/other');
    expect(collected.beforeRequest).not.toContain(fn);

    remove();
  });

  it('includes root "/" middleware for all paths', () => {
    const fn = jest.fn();
    const { remove } = addPathMiddleware('/', 'beforeRequest', fn);

    expect(collectMiddleware('/anything').beforeRequest).toContain(fn);
    expect(collectMiddleware('/deep/nested/path').beforeRequest).toContain(fn);

    remove();
  });

  it('executes path middleware in the correct order (global → path hierarchy)', async () => {
    const order: number[] = [];
    const globalFn = jest.fn().mockImplementation(() => { order.push(1); });
    const apiFn = jest.fn().mockImplementation(() => { order.push(2); });
    const usersPath = jest.fn().mockImplementation(() => { order.push(3); });

    const r1 = addMiddleware('beforeRequest', globalFn);
    const r2 = addPathMiddleware('/api', 'beforeRequest', apiFn);
    const r3 = addPathMiddleware('/api/users', 'beforeRequest', usersPath);

    await runMiddlewares('beforeRequest', makeReq('/api/users'), makeRes());
    expect(order).toEqual([1, 2, 3]);

    r1.remove();
    r2.remove();
    r3.remove();
  });
});
