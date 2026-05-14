import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

describe('cookies — Set-Cookie response', () => {
  it('sends a Set-Cookie header', async () => {
    const app = createTestApp({
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
    const response = await app.post('/login').expect(200);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('session=abc123');
  });

  it('sets Path=/ by default', async () => {
    const app = createTestApp({
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
    const response = await app.get('/set');
    expect(response.headers['set-cookie'][0]).toContain('Path=/');
  });

  it('includes HttpOnly, Secure, SameSite attributes', async () => {
    const app = createTestApp({
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
    const response = await app.get('/secure');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('sends multiple Set-Cookie headers for multiple cookies', async () => {
    const app = createTestApp({
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
    const response = await app.get('/multi');
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it('deletes a cookie by setting Max-Age=0', async () => {
    const app = createTestApp({
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
    const response = await app.post('/logout');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('cookies — reading request cookies', () => {
  it('reads a cookie sent by the client', async () => {
    const app = createTestApp({
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
    await app.get('/me')
      .set('Cookie', 'session=abc123')
      .expect(200)
      .expect({ session: 'abc123' });
  });

  it('returns undefined for a missing cookie', async () => {
    const app = createTestApp({
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
    await app.get('/me').expect(200).expect({ token: null });
  });

  it('reads multiple cookies', async () => {
    const app = createTestApp({
      routes: [{
        path: '/ctx',
        handlers: {
          GET: async (req: Request, res: Response) => {
            res.status(200).json(req.cookies.all());
          },
        },
      }],
    });
    await app.get('/ctx')
      .set('Cookie', 'a=1; b=2; c=3')
      .expect(200)
      .expect({ a: '1', b: '2', c: '3' });
  });
});
