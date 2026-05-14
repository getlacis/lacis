import { createCorsMiddleware } from '@/core/cors';
import { resetMiddlewares } from '@/core/middleware';
import { applyRequestMethods } from '@/utils/adapter-base';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Request, Response } from '@/types';

beforeEach(() => resetMiddlewares());

function makeReq(method = 'GET', origin?: string): Request {
  const req = new IncomingMessage(new Socket()) as Request;
  req.method = method;
  req.url = '/';
  if (origin) (req as any).headers = { origin };
  applyRequestMethods(req);
  return req;
}

function makeRes() {
  const req = new IncomingMessage(new Socket());
  const raw = new ServerResponse(req) as unknown as Response;
  const headers: Record<string, string | string[]> = {};
  raw.setHeader = (name: string, value: any) => { headers[name.toLowerCase()] = value; return raw; };
  raw.getHeader = (name: string) => headers[name.toLowerCase()];
  raw.end = (() => raw) as any;
  raw.status = (code: number) => { raw.statusCode = code; return raw; };
  return { raw, headers };
}

describe('createCorsMiddleware', () => {
  describe('origin matching', () => {
    it('wildcard (*) allows any origin', async () => {
      const mw = createCorsMiddleware({ origin: '*' });
      const req = makeReq('GET', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('*');
    });

    it('no origin config defaults to wildcard', async () => {
      const mw = createCorsMiddleware({});
      const req = makeReq('GET', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('*');
    });

    it('string origin — matching', async () => {
      const mw = createCorsMiddleware({ origin: 'https://myapp.com' });
      const req = makeReq('GET', 'https://myapp.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('https://myapp.com');
      expect(headers['vary']).toBe('Origin');
    });

    it('string origin — not matching sets no header', async () => {
      const mw = createCorsMiddleware({ origin: 'https://myapp.com' });
      const req = makeReq('GET', 'https://other.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('array of origins — match', async () => {
      const mw = createCorsMiddleware({ origin: ['https://a.com', 'https://b.com'] });
      const req = makeReq('GET', 'https://b.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('https://b.com');
      expect(headers['vary']).toBe('Origin');
    });

    it('array of origins — no match', async () => {
      const mw = createCorsMiddleware({ origin: ['https://a.com'] });
      const req = makeReq('GET', 'https://c.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('RegExp origin — match', async () => {
      const mw = createCorsMiddleware({ origin: /\.myapp\.com$/ });
      const req = makeReq('GET', 'https://api.myapp.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('https://api.myapp.com');
    });

    it('RegExp origin — no match', async () => {
      const mw = createCorsMiddleware({ origin: /\.myapp\.com$/ });
      const req = makeReq('GET', 'https://other.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('callback origin — allowed', async () => {
      const mw = createCorsMiddleware({ origin: (o) => o.endsWith('.trusted.com') });
      const req = makeReq('GET', 'https://app.trusted.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('https://app.trusted.com');
    });

    it('callback origin — denied', async () => {
      const mw = createCorsMiddleware({ origin: () => false });
      const req = makeReq('GET', 'https://evil.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('no Origin header — does nothing', async () => {
      const mw = createCorsMiddleware({ origin: '*' });
      const req = makeReq('GET');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('credentials', () => {
    it('sets Allow-Credentials when credentials: true', async () => {
      const mw = createCorsMiddleware({ origin: 'https://myapp.com', credentials: true });
      const req = makeReq('GET', 'https://myapp.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not set Allow-Credentials when credentials not set', async () => {
      const mw = createCorsMiddleware({ origin: '*' });
      const req = makeReq('GET', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('credentials:true with wildcard reflects origin instead of * (browsers reject wildcard+credentials)', async () => {
      const mw = createCorsMiddleware({ origin: '*', credentials: true });
      const req = makeReq('GET', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-origin']).toBe('https://example.com');
      expect(headers['access-control-allow-credentials']).toBe('true');
      expect(headers['vary']).toBe('Origin');
    });
  });

  describe('OPTIONS preflight', () => {
    it('responds 204 and returns false', async () => {
      const mw = createCorsMiddleware({ origin: '*' });
      const req = makeReq('OPTIONS', 'https://example.com');
      const { raw } = makeRes();
      const result = await mw(req, raw, undefined);
      expect(result).toBe(false);
      expect((raw as any).statusCode).toBe(204);
    });

    it('sets Allow-Methods and Allow-Headers on preflight', async () => {
      const mw = createCorsMiddleware({
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['X-Custom'],
      });
      const req = makeReq('OPTIONS', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-allow-methods']).toBe('GET, POST');
      expect(headers['access-control-allow-headers']).toBe('X-Custom');
    });

    it('sets Max-Age when maxAge is configured', async () => {
      const mw = createCorsMiddleware({ origin: '*', maxAge: 600 });
      const req = makeReq('OPTIONS', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-max-age']).toBe('600');
    });

    it('does not set Max-Age when not configured', async () => {
      const mw = createCorsMiddleware({ origin: '*' });
      const req = makeReq('OPTIONS', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-max-age']).toBeUndefined();
    });
  });

  describe('exposedHeaders', () => {
    it('sets Expose-Headers when configured', async () => {
      const mw = createCorsMiddleware({ origin: '*', exposedHeaders: ['X-Token', 'X-Count'] });
      const req = makeReq('GET', 'https://example.com');
      const { raw, headers } = makeRes();
      await mw(req, raw, undefined);
      expect(headers['access-control-expose-headers']).toBe('X-Token, X-Count');
    });
  });
});
