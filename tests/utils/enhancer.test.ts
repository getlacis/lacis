import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { enhanceRequest, enhanceResponse } from '@/utils/enhancer';

function makeReq(body?: string | Buffer, headers?: Record<string, string>): IncomingMessage {
  const req = new IncomingMessage(new Socket());
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

function makeRes(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
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

    it('rejects with code 413 when the body exceeds 10 MB', async () => {
      const req = new IncomingMessage(new Socket());
      const large = Buffer.alloc(10_485_761, 'x'); // 10 MB + 1 byte
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

  describe('bindForm()', () => {
    it('parses a single text field', async () => {
      const boundary = 'testboundary';
      const body = buildMultipart(boundary, [{ name: 'username', value: 'lycia' }]);
      const req = makeReq(body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      const enhanced = enhanceRequest(req);
      const data = await enhanced.bindForm<{ username: string }>();
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
      const enhanced = enhanceRequest(req);
      const data = await enhanced.bindForm<Record<string, string>>();
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
      const enhanced = enhanceRequest(req);
      const data = await enhanced.bindForm<{
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
      const enhanced = enhanceRequest(req);
      const data = await enhanced.bindForm<any>();
      expect(data.title).toBe('my upload');
      expect(data.file.filename).toBe('doc.txt');
      expect(data.file.size).toBe(fileContent.length);
    });

    it('rejects when content-type is not multipart/form-data', async () => {
      const req = makeReq('some body', { 'content-type': 'application/json' });
      const enhanced = enhanceRequest(req);
      await expect(enhanced.bindForm()).rejects.toThrow('Content-Type is not multipart/form-data');
    });

    it('rejects when boundary is missing from content-type', async () => {
      const req = makeReq('some body', { 'content-type': 'multipart/form-data' });
      const enhanced = enhanceRequest(req);
      await expect(enhanced.bindForm()).rejects.toThrow('Boundary not found');
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
