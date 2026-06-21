import { createTestApp } from './helpers/server';
import { defineHandler } from '@/core/defineHandler';
import type { Request, Response } from '@/types';

const handler200 = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };

describe('routing — per-route use: middleware (method scoping)', () => {
  it('applies use: middleware only to the method that declares it', async () => {
    const guard = async (_req: Request, res: Response) => {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    };
    const { request, close } = await createTestApp({
      routes: [{
        path: '/users',
        handlers: {
          GET: defineHandler({ handler: async (_req, res) => { res.status(200).json({ list: true }); } }),
          POST: defineHandler({ use: [guard], handler: async (_req, res) => { res.status(201).json({ created: true }); } }),
        },
      }],
    });
    await request.get('/users').expect(200).expect({ list: true });
    await request.post('/users').expect(401).expect({ error: 'unauthorized' });
    await close();
  });
});

describe('routing — static routes', () => {
  it('responds 200 on a registered GET route', async () => {
    const { request, close } = await createTestApp({ routes: [{ path: '/hello', handlers: { GET: handler200 } }] });
    await request.get('/hello').expect(200).expect({ ok: true });
    await close();
  });

  it('responds 404 for an unregistered path', async () => {
    const { request, close } = await createTestApp({ routes: [] });
    await request.get('/nope').expect(404);
    await close();
  });

  it('responds 405 when method is not registered', async () => {
    const { request, close } = await createTestApp({ routes: [{ path: '/users', handlers: { GET: handler200 } }] });
    await request.post('/users').expect(405);
    await close();
  });

  it('sets the Allow header listing registered methods on a 405', async () => {
    const { request, close } = await createTestApp({
      routes: [{ path: '/users', handlers: { GET: handler200, POST: handler200 } }],
    });
    const res = await request.delete('/users').expect(405);
    const allow = (res.headers['allow'] ?? '').split(',').map((m: string) => m.trim()).sort();
    expect(allow).toEqual(['GET', 'POST']);
    await close();
  });

  it('trailing slash is normalised', async () => {
    const { request, close } = await createTestApp({ routes: [{ path: '/about', handlers: { GET: handler200 } }] });
    await request.get('/about/').expect(200);
    await close();
  });

  it('HEAD falls back to GET handler', async () => {
    const { request, close } = await createTestApp({ routes: [{ path: '/ping', handlers: { GET: handler200 } }] });
    await request.head('/ping').expect(200);
    await close();
  });
});

describe('routing — dynamic params', () => {
  it('extracts a single :param and exposes it on req.params', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/users/:id',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json({ id: req.params?.id });
          },
        },
      }],
    });
    await request.get('/users/42').expect(200).expect({ id: '42' });
    await close();
  });

  it('extracts multiple params', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/orgs/:org/repos/:repo',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json(req.params);
          },
        },
      }],
    });
    await request.get('/orgs/acme/repos/lacis').expect(200).expect({ org: 'acme', repo: 'lacis' });
    await close();
  });

  it('static segment takes priority over param when both match', async () => {
    const { request, close } = await createTestApp({
      routes: [
        { path: '/items/featured', handlers: { GET: async (_req: Request, res: Response) => { res.status(200).json({ type: 'static' }); } } },
        { path: '/items/:id',      handlers: { GET: async (_req: Request, res: Response) => { res.status(200).json({ type: 'param' }); } } },
      ],
    });
    await request.get('/items/featured').expect(200).expect({ type: 'static' });
    await request.get('/items/123').expect(200).expect({ type: 'param' });
    await close();
  });
});

describe('routing — request body', () => {
  it('reads a JSON body via req.json()', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/echo',
        handlers: {
          POST: async (req: Request, res: Response) => {
            const body = await req.json<{ name: string }>();
            res.status(200).json(body);
          },
        },
      }],
    });
    await request.post('/echo')
      .set('Content-Type', 'application/json')
      .send({ name: 'lacis' })
      .expect(200)
      .expect({ name: 'lacis' });
    await close();
  });
});

describe('routing — param name consistency', () => {
  it('GET and POST on the same path share the param name correctly', async () => {
    const { request, close } = await createTestApp({
      routes: [
        {
          path: '/users/:id',
          handlers: {
            GET:  async (req: Request, res: Response) => res.status(200).json({ method: 'GET',  id: req.params?.id }),
            POST: async (req: Request, res: Response) => res.status(200).json({ method: 'POST', id: req.params?.id }),
          },
        },
      ],
    });
    await request.get('/users/42').expect(200).expect({ method: 'GET', id: '42' });
    await request.post('/users/99').expect(200).expect({ method: 'POST', id: '99' });
    await close();
  });

  it('throws at registration when two methods use different param names at the same position', async () => {
    await expect(
      createTestApp({
        routes: [
          { path: '/users/:id',     handlers: { GET:  async (_req: Request, res: Response) => res.json({}) } },
          { path: '/users/:userId', handlers: { POST: async (_req: Request, res: Response) => res.json({}) } },
        ],
      }),
    ).rejects.toThrow(/param name.*userId.*conflicts.*id/);
  });
});

describe('routing — query string', () => {
  it('preserves query string in req.url', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/search',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json({ url: req.url });
          },
        },
      }],
    });
    const { body } = await request.get('/search?q=hello&page=2').expect(200);
    expect(body.url).toContain('q=hello');
    expect(body.url).toContain('page=2');
    await close();
  });
});
