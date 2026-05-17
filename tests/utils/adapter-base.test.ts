import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { withRequestMethods, withResponseMethods, nodeBody } from '@/utils/adapter-base';

class _TestReqBase extends IncomingMessage {
  params: Record<string, string> = {};
  body = nodeBody;
}
class TestRequest extends withRequestMethods(_TestReqBase) {}

class TestResponse extends withResponseMethods(ServerResponse<IncomingMessage>) {}

function makeReq(body?: string | Buffer, headers?: Record<string, string>): TestRequest {
  const req = new TestRequest(new Socket());
  if (headers) {
    (req as any).headers = { ...headers };
  }
  if (body !== undefined) {
    process.nextTick(() => {
      req.push(typeof body === 'string' ? Buffer.from(body) : body);
      req.push(null);
    });
  }
  return req;
}

function makeRes(): TestResponse {
  return new TestResponse(new IncomingMessage(new Socket()));
}

function buildMultipart(boundary: string, parts: Array<{
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}>): Buffer {
  const CRLF = '\r\n';
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}`));
    let disposition = `Content-Disposition: form-data; name="${part.name}"`;
    if (part.filename) disposition += `; filename="${part.filename}"`;
    chunks.push(Buffer.from(disposition + CRLF));
    if (part.contentType) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}${CRLF}`));
    }
    chunks.push(Buffer.from(CRLF));
    chunks.push(part.data ?? Buffer.from(part.value ?? ''));
    chunks.push(Buffer.from(CRLF));
  }

  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(chunks);
}

describe('withRequestMethods', () => {
  describe('body()', () => {
    it('collects all chunks into a single Buffer', async () => {
      const req = makeReq('hello world');
      const buf = await req.body();
      expect(buf.toString()).toBe('hello world');
    });

    it('resolves to an empty buffer when the body is empty', async () => {
      const req = makeReq('');
      const buf = await req.body();
      expect(buf.length).toBe(0);
    });

    it('rejects with code 413 when the body exceeds 10 MB', async () => {
      const req = new TestRequest(new Socket());
      const large = Buffer.alloc(10_485_761, 'x'); // 10 MB + 1 byte
      process.nextTick(() => {
        req.push(large);
        req.push(null);
      });
      await expect(req.body()).rejects.toMatchObject({ code: 413 });
    });
  });

  describe('json()', () => {
    it('parses a valid JSON body', async () => {
      const payload = { name: 'lacis', version: 1 };
      const req = makeReq(JSON.stringify(payload), { 'content-type': 'application/json' });
      const data = await req.json<typeof payload>();
      expect(data).toEqual(payload);
    });

    it('rejects on malformed JSON', async () => {
      const req = makeReq('{invalid json}', { 'content-type': 'application/json' });
      await expect(req.json()).rejects.toThrow();
    });
  });

  describe('form()', () => {
    it('parses a single text field', async () => {
      const boundary = 'testboundary';
      const body = buildMultipart(boundary, [{ name: 'username', value: 'lycia' }]);
      const req = makeReq(body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      const data = await req.form<{ username: string }>();
      expect(data).toEqual({ username: 'lycia' });
    });

    it('parses multiple text fields', async () => {
      const boundary = 'testboundary';
      const body = buildMultipart(boundary, [
        { name: 'firstName', value: 'Lycia' },
        { name: 'lastName', value: 'Dufour' },
        { name: 'age', value: '30' },
      ]);
      const req = makeReq(body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      const data = await req.form<Record<string, string>>();
      expect(data).toEqual({ firstName: 'Lycia', lastName: 'Dufour', age: '30' });
    });

    it('parses a file upload with filename and mime type', async () => {
      const boundary = 'fileboundary';
      const fileContent = Buffer.from('hello from file');
      const body = buildMultipart(boundary, [{
        name: 'avatar',
        filename: 'avatar.png',
        contentType: 'image/png',
        data: fileContent,
      }]);
      const req = makeReq(body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      const data = await req.form<{
        avatar: { filename: string; mimetype: string; data: Buffer; size: number };
      }>();
      expect(data.avatar.filename).toBe('avatar.png');
      expect(data.avatar.mimetype).toBe('image/png');
      expect(data.avatar.size).toBe(fileContent.length);
      expect(Buffer.from(data.avatar.data).toString()).toBe('hello from file');
    });

    it('parses mixed text fields and file upload', async () => {
      const boundary = 'mixedboundary';
      const fileContent = Buffer.from('file data');
      const body = buildMultipart(boundary, [
        { name: 'title', value: 'my upload' },
        { name: 'file', filename: 'doc.txt', contentType: 'text/plain', data: fileContent },
      ]);
      const req = makeReq(body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      const data = await req.form<{ title: string; file: { filename: string; size: number } }>();
      expect(data.title).toBe('my upload');
      expect(data.file.filename).toBe('doc.txt');
      expect(data.file.size).toBe(fileContent.length);
    });

    it('rejects when content-type is not multipart/form-data', async () => {
      const req = makeReq('some body', { 'content-type': 'application/json' });
      await expect(req.form()).rejects.toThrow('Content-Type is not multipart/form-data');
    });

    it('rejects when boundary is missing from content-type', async () => {
      const req = makeReq('some body', { 'content-type': 'multipart/form-data' });
      await expect(req.form()).rejects.toThrow('Boundary not found');
    });
  });
});

describe('withResponseMethods', () => {
  describe('status()', () => {
    it('sets statusCode and returns the response for chaining', () => {
      const res = makeRes();
      const returned = res.status(201);
      expect(res.statusCode).toBe(201);
      expect(returned).toBe(res);
    });
  });

  describe('json()', () => {
    it('sets Content-Type to application/json', () => {
      const res = makeRes();
      res.json({ ok: true });
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });

    it('works when chained after status()', () => {
      const res = makeRes();
      res.status(422).json({ error: 'bad input' });
      expect(res.statusCode).toBe(422);
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });
  });

  describe('send()', () => {
    it('sets Content-Type to text/plain for strings', () => {
      const res = makeRes();
      res.send('hello');
      expect(res.getHeader('Content-Type')).toBe('text/plain');
    });

    it('falls through to json() for non-string values', () => {
      const res = makeRes();
      res.send({ data: 42 });
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });
  });

  describe('html()', () => {
    it('sets Content-Type to text/html; charset=utf-8', () => {
      const res = makeRes();
      res.html('<h1>hello</h1>');
      expect(res.getHeader('Content-Type')).toBe('text/html; charset=utf-8');
    });

    it('works when chained after status()', () => {
      const res = makeRes();
      res.status(201).html('<p>created</p>');
      expect(res.statusCode).toBe(201);
      expect(res.getHeader('Content-Type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('redirect()', () => {
    it('defaults to 302 and sets Location header', () => {
      const res = makeRes();
      res.redirect('/login');
      expect(res.statusCode).toBe(302);
      expect(res.getHeader('Location')).toBe('/login');
    });

    it('accepts a custom status code', () => {
      const res = makeRes();
      res.redirect('/new-path', 301);
      expect(res.statusCode).toBe(301);
      expect(res.getHeader('Location')).toBe('/new-path');
    });
  });
});
