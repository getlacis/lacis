import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

describe('cookies — Set-Cookie response', () => {
  it('sends a Set-Cookie header', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/login',
        handlers: {
          POST: async (_req: Request, res: Response) => {
            res.cookies.set('session', 'abc123');
            res.status(200).json({ ok: true });
          },
        },
      }],
    });
    const response = await request.post('/login').expect(200);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('session=abc123');
    await close();
  });

  it('sets Path=/ by default', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/set',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.cookies.set('k', 'v');
            res.status(200).json({});
          },
        },
      }],
    });
    const response = await request.get('/set');
    expect(response.headers['set-cookie'][0]).toContain('Path=/');
    await close();
  });

  it('includes HttpOnly, Secure, SameSite attributes', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/secure',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.cookies.set('token', 'xyz', { httpOnly: true, secure: true, sameSite: 'Strict' });
            res.status(200).json({});
          },
        },
      }],
    });
    const response = await request.get('/secure');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    await close();
  });

  it('sends multiple Set-Cookie headers for multiple cookies', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/multi',
        handlers: {
          GET: async (_req: Request, res: Response) => {
            res.cookies.set('a', '1').set('b', '2');
            res.status(200).json({});
          },
        },
      }],
    });
    const response = await request.get('/multi');
    expect(response.headers['set-cookie']).toHaveLength(2);
    await close();
  });

  it('deletes a cookie by setting Max-Age=0', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/logout',
        handlers: {
          POST: async (_req: Request, res: Response) => {
            res.cookies.delete('session');
            res.status(200).json({});
          },
        },
      }],
    });
    const response = await request.post('/logout');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    await close();
  });
});

describe('cookies — reading request cookies', () => {
  it('reads a cookie sent by the client', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/me',
        handlers: {
          GET: async (req: Request, res: Response) => {
            const session = req.cookies.get('session');
            res.status(200).json({ session });
          },
        },
      }],
    });
    await request.get('/me')
      .set('Cookie', 'session=abc123')
      .expect(200)
      .expect({ session: 'abc123' });
    await close();
  });

  it('returns undefined for a missing cookie', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/me',
        handlers: {
          GET: async (req: Request, res: Response) => {
            const token = req.cookies.get('token');
            res.status(200).json({ token: token ?? null });
          },
        },
      }],
    });
    await request.get('/me').expect(200).expect({ token: null });
    await close();
  });

  it('reads multiple cookies', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/ctx',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json(req.cookies.all());
          },
        },
      }],
    });
    await request.get('/ctx')
      .set('Cookie', 'a=1; b=2; c=3')
      .expect(200)
      .expect({ a: '1', b: '2', c: '3' });
    await close();
  });
});
