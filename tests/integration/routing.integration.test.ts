import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

const handler200 = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };

describe('routing — static routes', () => {
  it('responds 200 on a registered GET route', async () => {
    const app = createTestApp({ routes: [{ path: '/hello', handlers: { GET: handler200 } }] });
    await app.get('/hello').expect(200).expect({ ok: true });
  });

  it('responds 404 for an unregistered path', async () => {
    const app = createTestApp({ routes: [] });
    await app.get('/nope').expect(404);
  });

  it('responds 405 when method is not registered', async () => {
    const app = createTestApp({ routes: [{ path: '/users', handlers: { GET: handler200 } }] });
    await app.post('/users').expect(405);
  });

  it('trailing slash is normalised', async () => {
    const app = createTestApp({ routes: [{ path: '/about', handlers: { GET: handler200 } }] });
    await app.get('/about/').expect(200);
  });

  it('HEAD falls back to GET handler', async () => {
    const app = createTestApp({ routes: [{ path: '/ping', handlers: { GET: handler200 } }] });
    await app.head('/ping').expect(200);
  });
});

describe('routing — dynamic params', () => {
  it('extracts a single :param and exposes it on req.params', async () => {
    const app = createTestApp({
      routes: [{
        path: '/users/:id',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json({ id: req.params?.id });
          },
        },
      }],
    });
    await app.get('/users/42').expect(200).expect({ id: '42' });
  });

  it('extracts multiple params', async () => {
    const app = createTestApp({
      routes: [{
        path: '/orgs/:org/repos/:repo',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json(req.params);
          },
        },
      }],
    });
    await app.get('/orgs/acme/repos/lacis').expect(200).expect({ org: 'acme', repo: 'lacis' });
  });

  it('static segment takes priority over param when both match', async () => {
    const app = createTestApp({
      routes: [
        { path: '/items/featured', handlers: { GET: async (_req: Request, res: Response) => { res.status(200).json({ type: 'static' }); } } },
        { path: '/items/:id',      handlers: { GET: async (_req: Request, res: Response) => { res.status(200).json({ type: 'param' }); } } },
      ],
    });
    await app.get('/items/featured').expect(200).expect({ type: 'static' });
    await app.get('/items/123').expect(200).expect({ type: 'param' });
  });
});

describe('routing — request body', () => {
  it('reads a JSON body via req.json()', async () => {
    const app = createTestApp({
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
    await app.post('/echo')
      .set('Content-Type', 'application/json')
      .send({ name: 'lacis' })
      .expect(200)
      .expect({ name: 'lacis' });
  });
});

describe('routing — param name consistency', () => {
  it('GET and POST on the same path share the param name correctly', async () => {
    const app = createTestApp({
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
    await app.get('/users/42').expect(200).expect({ method: 'GET', id: '42' });
    await app.post('/users/99').expect(200).expect({ method: 'POST', id: '99' });
  });

  it('throws at registration when two methods use different param names at the same position', () => {
    expect(() =>
      createTestApp({
        routes: [
          { path: '/users/:id',     handlers: { GET:  async (_req: Request, res: Response) => res.json({}) } },
          { path: '/users/:userId', handlers: { POST: async (_req: Request, res: Response) => res.json({}) } },
        ],
      }),
    ).toThrow(/param name.*userId.*conflicts.*id/);
  });
});

describe('routing — query string', () => {
  it('preserves query string in req.url', async () => {
    const app = createTestApp({
      routes: [{
        path: '/search',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json({ url: req.url });
          },
        },
      }],
    });
    const { body } = await app.get('/search?q=hello&page=2').expect(200);
    expect(body.url).toContain('q=hello');
    expect(body.url).toContain('page=2');
  });
});
