import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

const ok = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };
const routes = [{ path: '/api', handlers: { GET: ok } }];

describe('middleware — beforeRequest', () => {
  it('runs before the route handler', async () => {
    const order: string[] = [];
    const app = createTestApp({
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
    await app.get('/api').expect(200);
    expect(order).toEqual(['before', 'handler']);
  });

  it('stops the chain and skips the handler when returning false', async () => {
    const handlerSpy = jest.fn();
    const app = createTestApp({
      routes: [{ path: '/api', handlers: { GET: handlerSpy } }],
      middleware: {
        beforeRequest: async (_req: Request, res: Response) => {
          res.status(403).json({ error: 'forbidden' });
          return false;
        },
      },
    });
    await app.get('/api').expect(403).expect({ error: 'forbidden' });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('can add custom request headers visible to the handler', async () => {
    const app = createTestApp({
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
          (req as any).headers['x-powered-by'] = 'zeno';
        },
      },
    });
    await app.get('/api').expect(200).expect({ powered: 'zeno' });
  });
});

describe('middleware — afterRequest', () => {
  it('runs after the route handler', async () => {
    const order: string[] = [];
    let afterCalled = false;
    const app = createTestApp({
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
    await app.get('/api').expect(200);
    expect(afterCalled).toBe(true);
    expect(order.indexOf('handler')).toBeLessThan(order.indexOf('after'));
  });
});

describe('middleware — response headers', () => {
  it('headers set in beforeRequest appear in the response', async () => {
    const app = createTestApp({
      routes,
      middleware: {
        beforeRequest: async (_req: Request, res: Response) => {
          res.setHeader('X-Request-Id', 'test-123');
        },
      },
    });
    await app.get('/api').expect('X-Request-Id', 'test-123');
  });
});

describe('middleware — multiple handlers', () => {
  it('runs an array of beforeRequest middlewares in order', async () => {
    const order: number[] = [];
    const app = createTestApp({
      routes,
      middleware: {
        beforeRequest: [
          async () => { order.push(1); },
          async () => { order.push(2); },
          async () => { order.push(3); },
        ],
      },
    });
    await app.get('/api').expect(200);
    expect(order).toEqual([1, 2, 3]);
  });
});
