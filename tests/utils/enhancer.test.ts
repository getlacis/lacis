import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { enhanceRequest, enhanceResponse } from '@/utils/enhancer';

function makeReq(body?: string, headers?: Record<string, string>): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  if (headers) {
    (req as any).headers = { ...headers };
  }
  if (body !== undefined) {
    process.nextTick(() => {
      req.push(Buffer.from(body));
      req.push(null);
    });
  }
  return req;
}

function makeRes(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

describe('enhanceRequest', () => {
  describe('body()', () => {
    it('collects all chunks into a single Buffer', async () => {
      const req = makeReq('hello world');
      const enhanced = enhanceRequest(req);
      const buf = await enhanced.body();
      expect(buf.toString()).toBe('hello world');
    });

    it('resolves to an empty buffer when the body is empty', async () => {
      const req = makeReq('');
      const enhanced = enhanceRequest(req);
      const buf = await enhanced.body();
      expect(buf.length).toBe(0);
    });

    it('rejects with code 413 when the body exceeds 1 MB', async () => {
      const req = new IncomingMessage(new Socket());
      const large = Buffer.alloc(1_048_577, 'x'); // 1 MB + 1 byte
      process.nextTick(() => {
        req.push(large);
        req.push(null);
      });

      const enhanced = enhanceRequest(req);
      await expect(enhanced.body()).rejects.toMatchObject({ code: 413 });
    });
  });

  describe('bindJSON()', () => {
    it('parses a valid JSON body', async () => {
      const payload = { name: 'zeno', version: 1 };
      const req = makeReq(JSON.stringify(payload), { 'content-type': 'application/json' });
      const enhanced = enhanceRequest(req);
      const data = await enhanced.bindJSON<typeof payload>();
      expect(data).toEqual(payload);
    });

    it('rejects on malformed JSON', async () => {
      const req = makeReq('{invalid json}', { 'content-type': 'application/json' });
      const enhanced = enhanceRequest(req);
      await expect(enhanced.bindJSON()).rejects.toThrow();
    });
  });
});

describe('enhanceResponse', () => {
  describe('status()', () => {
    it('sets statusCode and returns the response for chaining', () => {
      const res = makeRes();
      const enhanced = enhanceResponse(res);
      const returned = enhanced.status(201);
      expect(res.statusCode).toBe(201);
      expect(returned).toBe(enhanced);
    });
  });

  describe('json()', () => {
    it('sets Content-Type to application/json', () => {
      const res = makeRes();
      const enhanced = enhanceResponse(res);
      enhanced.json({ ok: true });
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });

    it('works when chained after status()', () => {
      const res = makeRes();
      const enhanced = enhanceResponse(res);
      enhanced.status(422).json({ error: 'bad input' });
      expect(res.statusCode).toBe(422);
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });
  });

  describe('send()', () => {
    it('sets Content-Type to text/plain for strings', () => {
      const res = makeRes();
      const enhanced = enhanceResponse(res);
      enhanced.send('hello');
      expect(res.getHeader('Content-Type')).toBe('text/plain');
    });

    it('falls through to json() for non-string values', () => {
      const res = makeRes();
      const enhanced = enhanceResponse(res);
      enhanced.send({ data: 42 });
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });
  });
});
