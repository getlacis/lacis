import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

const ok = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };
const routes = [{ path: '/api', handlers: { GET: ok } }];

describe('CORS — wildcard', () => {
  it('sets Access-Control-Allow-Origin: * for any origin', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: '*' } });
    await request.get('/api').set('Origin', 'https://example.com').expect('Access-Control-Allow-Origin', '*');
    await close();
  });

  it('does not set CORS headers when Origin header is absent', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: '*' } });
    const res = await request.get('/api');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await close();
  });
});

describe('CORS — specific origin', () => {
  it('echoes the origin and sets Vary when it matches', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: 'https://myapp.com' } });
    await request.get('/api')
      .set('Origin', 'https://myapp.com')
      .expect('Access-Control-Allow-Origin', 'https://myapp.com')
      .expect('Vary', 'Origin');
    await close();
  });

  it('does not set ACAO when origin does not match', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: 'https://myapp.com' } });
    const res = await request.get('/api').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await close();
  });

  it('accepts an array of allowed origins', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: ['https://a.com', 'https://b.com'] } });
    await request.get('/api').set('Origin', 'https://b.com').expect('Access-Control-Allow-Origin', 'https://b.com');
    const res = await request.get('/api').set('Origin', 'https://c.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await close();
  });

  it('accepts a RegExp origin', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: /\.myapp\.com$/ } });
    await request.get('/api').set('Origin', 'https://api.myapp.com').expect('Access-Control-Allow-Origin', 'https://api.myapp.com');
    await close();
  });
});

describe('CORS — credentials', () => {
  it('sets Access-Control-Allow-Credentials: true', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: 'https://myapp.com', credentials: true } });
    await request.get('/api')
      .set('Origin', 'https://myapp.com')
      .expect('Access-Control-Allow-Credentials', 'true');
    await close();
  });

  it('reflects origin instead of * when credentials:true + wildcard (browser spec)', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: '*', credentials: true } });
    await request.get('/api')
      .set('Origin', 'https://example.com')
      .expect('Access-Control-Allow-Origin', 'https://example.com')
      .expect('Access-Control-Allow-Credentials', 'true');
    await close();
  });
});

describe('CORS — preflight (OPTIONS)', () => {
  it('responds 204 to OPTIONS preflight', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: '*' } });
    await request.options('/api')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    await close();
  });

  it('sets Allow-Methods and Allow-Headers on preflight', async () => {
    const { request, close } = await createTestApp({
      routes,
      cors: { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['X-Token'] },
    });
    const res = await request.options('/api')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBe('X-Token');
    await close();
  });

  it('sets Max-Age when configured', async () => {
    const { request, close } = await createTestApp({ routes, cors: { origin: '*', maxAge: 600 } });
    await request.options('/api')
      .set('Origin', 'https://example.com')
      .expect('Access-Control-Max-Age', '600');
    await close();
  });
});
