import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

describe('res.html()', () => {
  it('returns 200 with text/html content-type', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/page',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.html('<h1>hello</h1>');
          },
        },
      }],
    });
    await request.get('/page')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect('<h1>hello</h1>');
    await close();
  });

  it('respects a status set before html()', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/created',
        handlers: {
          POST: async (_req: Request, res: Response) => {
            res.status(201).html('<p>created</p>');
          },
        },
      }],
    });
    await request.post('/created').expect(201).expect('Content-Type', /text\/html/);
    await close();
  });
});

describe('res.redirect()', () => {
  it('returns 302 with a Location header by default', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/old',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.redirect('/new');
          },
        },
      }],
    });
    await request.get('/old').redirects(0).expect(302).expect('Location', '/new');
    await close();
  });

  it('returns 301 when explicitly specified', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/permanent',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.redirect('/destination', 301);
          },
        },
      }],
    });
    await request.get('/permanent').redirects(0).expect(301).expect('Location', '/destination');
    await close();
  });


});
