import { createTestApp } from './helpers/server';
import type { Request, Response } from '@/types';

const ok = async (_req: Request, res: Response) => { res.status(200).json({ ok: true }); };
const routes = [{ path: '/api', handlers: { GET: ok } }];

describe('CORS — wildcard', () => {
  it('sets Access-Control-Allow-Origin: * for any origin', async () => {
    const app = createTestApp({ routes, cors: { origin: '*' } });
    await app.get('/api')
      .set('Origin', 'https://example.com')
      .expect('Access-Control-Allow-Origin', '*');
  });

  it('does not set CORS headers when Origin header is absent', async () => {
    const app = createTestApp({ routes, cors: { origin: '*' } });
    const res = await app.get('/api');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — specific origin', () => {
  it('echoes the origin and sets Vary when it matches', async () => {
    const app = createTestApp({ routes, cors: { origin: 'https://myapp.com' } });
    await app.get('/api')
      .set('Origin', 'https://myapp.com')
      .expect('Access-Control-Allow-Origin', 'https://myapp.com')
      .expect('Vary', 'Origin');
  });

  it('does not set ACAO when origin does not match', async () => {
    const app = createTestApp({ routes, cors: { origin: 'https://myapp.com' } });
    const res = await app.get('/api').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts an array of allowed origins', async () => {
    const app = createTestApp({ routes, cors: { origin: ['https://a.com', 'https://b.com'] } });
    await app.get('/api').set('Origin', 'https://b.com')
      .expect('Access-Control-Allow-Origin', 'https://b.com');
    const res = await app.get('/api').set('Origin', 'https://c.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts a RegExp origin', async () => {
    const app = createTestApp({ routes, cors: { origin: /\.myapp\.com$/ } });
    await app.get('/api').set('Origin', 'https://api.myapp.com')
      .expect('Access-Control-Allow-Origin', 'https://api.myapp.com');
  });
});

describe('CORS — credentials', () => {
  it('sets Access-Control-Allow-Credentials: true', async () => {
    const app = createTestApp({ routes, cors: { origin: 'https://myapp.com', credentials: true } });
    await app.get('/api')
      .set('Origin', 'https://myapp.com')
      .expect('Access-Control-Allow-Credentials', 'true');
  });

  it('reflects origin instead of * when credentials:true + wildcard (browser spec)', async () => {
    const app = createTestApp({ routes, cors: { origin: '*', credentials: true } });
    await app.get('/api')
      .set('Origin', 'https://example.com')
      .expect('Access-Control-Allow-Origin', 'https://example.com')
      .expect('Access-Control-Allow-Credentials', 'true');
  });
});

describe('CORS — preflight (OPTIONS)', () => {
  it('responds 204 to OPTIONS preflight', async () => {
    const app = createTestApp({ routes, cors: { origin: '*' } });
    await app.options('/api')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
  });

  it('sets Allow-Methods and Allow-Headers on preflight', async () => {
    const app = createTestApp({
      routes,
      cors: { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['X-Token'] },
    });
    const res = await app.options('/api')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBe('X-Token');
  });

  it('sets Max-Age when configured', async () => {
    const app = createTestApp({ routes, cors: { origin: '*', maxAge: 600 } });
    await app.options('/api')
      .set('Origin', 'https://example.com')
      .expect('Access-Control-Max-Age', '600');
  });
});
