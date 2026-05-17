import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

const ok = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };
const routes = [{ path: '/api', handlers: { GET: ok } }];

describe('middleware — beforeRequest', () => {
  it('runs before the route handler', async () => {
    const order: string[] = [];
    const { request, close } = await createTestApp({
      routes: [{
        path: '/api',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            order.push('handler');
            res.status(200).json({ order });
          },
        },
      }],
      middleware: {
        beforeRequest: async () => { order.push('before'); },
      },
    });
    await request.get('/api').expect(200);
    expect(order).toEqual(['before', 'handler']);
    await close();
  });

  it('stops the chain and skips the handler when returning false', async () => {
    const handlerSpy = jest.fn();
    const { request, close } = await createTestApp({
      routes: [{ path: '/api', handlers: { GET: handlerSpy } }],
      middleware: {
        beforeRequest: async (_req: Request, res: Response) => {
          res.status(403).json({ error: 'forbidden' });
          return false;
        },
      },
    });
    await request.get('/api').expect(403).expect({ error: 'forbidden' });
    expect(handlerSpy).not.toHaveBeenCalled();
    await close();
  });

  it('can add custom request headers visible to the handler', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/api',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json({ powered: req.getHeader('x-powered-by') });
          },
        },
      }],
      middleware: {
        beforeRequest: async (req: Request) => {
          (req as any).headers['x-powered-by'] = 'lacis';
        },
      },
    });
    await request.get('/api').expect(200).expect({ powered: 'lacis' });
    await close();
  });
});

describe('middleware — afterRequest', () => {
  it('runs after the route handler', async () => {
    const order: string[] = [];
    let afterCalled = false;
    const { request, close } = await createTestApp({
      routes: [{
        path: '/api',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            order.push('handler');
            res.status(200).json({});
          },
        },
      }],
      middleware: {
        afterRequest: async () => { order.push('after'); afterCalled = true; },
      },
    });
    await request.get('/api').expect(200);
    expect(afterCalled).toBe(true);
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('after'));
    await close();
  });
});

describe('middleware — response headers', () => {
  it('headers set in beforeRequest appear in the response', async () => {
    const { request, close } = await createTestApp({
      routes,
      middleware: {
        beforeRequest: async (_req: Request, res: Response) => {
          res.setHeader('X-Request-Id', 'test-123');
        },
      },
    });
    await request.get('/api').expect('X-Request-Id', 'test-123');
    await close();
  });
});

describe('middleware — onError', () => {
  it('calls onError when the route handler throws', async () => {
    let onErrorCalled = false;
    const { request, close } = await createTestApp({
      routes: [{
        path: '/api',
        handlers: {
          GET: async () => { throw new Error('boom'); },
        },
      }],
      middleware: {
        onError: async (_req: Request, res: Response) => {
          onErrorCalled = true;
          res.status(500).json({ error: 'custom error' });
        },
      },
    });
    await request.get('/api').expect(500).expect({ error: 'custom error' });
    expect(onErrorCalled).toBe(true);
    await close();
  });

  it('does not send 500 fallback if onError already responded', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/api',
        handlers: {
          GET: async () => { throw new Error('boom'); },
        },
      }],
      middleware: {
        onError: async (_req: Request, res: Response) => {
          res.status(503).json({ error: 'service unavailable' });
        },
      },
    });
    await request.get('/api').expect(503).expect({ error: 'service unavailable' });
    await close();
  });
});

describe('middleware — multiple handlers', () => {
  it('runs an array of beforeRequest middlewares in order', async () => {
    const order: number[] = [];
    const { request, close } = await createTestApp({
      routes,
      middleware: {
        beforeRequest: [
          async () => { order.push(1); },
          async () => { order.push(2); },
          async () => { order.push(3); },
        ],
      },
    });
    await request.get('/api').expect(200);
    expect(order).toEqual([1, 2, 3]);
    await close();
  });
});
