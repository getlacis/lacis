import { hasMiddlewares, runMiddlewares } from "@/core/middleware";
import { isHttpError, normalizeError, sendError } from "@/core/errors";
import type { Request, Response } from "@/types";
import { createSSEClient } from "@/sse/client";
import { initSSE } from "@/sse/server";
import type {
  CookieOptions,
  SSEClient,
  SSEClientOptions,
  SSEEventHandlers,
  SSEOptions,
} from "@/types";
import { DEFAULT_MAX_BODY_SIZE } from "@/utils/constants";

export interface LacisHeaders {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(cb: (value: string, key: string) => void): void;
}

export class RequestCookiesImpl {
  private _parsed: Record<string, string> | null = null;
  private readonly _raw: string | undefined;

  constructor(raw: string | undefined) {
    this._raw = raw;
  }

  private _parse(): Record<string, string> {
    if (this._parsed !== null) return this._parsed;
    this._parsed = {};
    if (!this._raw) return this._parsed;
    for (const part of this._raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) {
        const unquoted = v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
        try { this._parsed[k] = decodeURIComponent(unquoted); } catch { this._parsed[k] = unquoted; }
      }
    }
    return this._parsed;
  }

  get(name: string): string | undefined {
    return this._parse()[name];
  }

  all(): Record<string, string> {
    return { ...this._parse() };
  }
}

export class ResponseCookiesImpl {
  private _pending: Array<{ name: string; value: string; opts: CookieOptions }> = [];

  set(name: string, value: string, options: CookieOptions = {}): this {
    this._pending.push({ name, value, opts: options });
    return this;
  }

  delete(name: string, options: Pick<CookieOptions, 'path' | 'domain'> = {}): this {
    return this.set(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  }

  serialize(): string[] {
    return this._pending.map(({ name, value, opts }) => {
      let str = `${name}=${encodeURIComponent(value)}`;
      const path = opts.path !== undefined ? opts.path : '/';
      if (path) str += `; Path=${path}`;
      if (opts.domain) str += `; Domain=${opts.domain}`;
      if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
      if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
      if (opts.httpOnly) str += '; HttpOnly';
      if (opts.secure) str += '; Secure';
      if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
      return str;
    });
  }
}

function parseCookieHeader(
  headers: LacisHeaders | Record<string, string | string[] | undefined>,
): string | undefined {
  if (typeof (headers as LacisHeaders).get === 'function') {
    return (headers as LacisHeaders).get('cookie') ?? undefined;
  }
  const raw = (headers as Record<string, string | string[] | undefined>)['cookie'];
  if (Array.isArray(raw)) return raw.join('; ');
  return raw;
}

// Request mixin

export type RequestMixinBase = new (...args: any[]) => {
  params: Record<string, string>;
  headers: LacisHeaders | Record<string, string | string[] | undefined>;
};

export function withRequestMethods<T extends RequestMixinBase>(Base: T) {
  return class extends Base {
    _zreqCookies?: RequestCookiesImpl;

    getHeader(name: string): string | undefined {
      const h = this.headers;
      if (typeof (h as LacisHeaders).get === 'function') {
        return (h as LacisHeaders).get(name) ?? undefined;
      }
      const val = (h as Record<string, string | string[] | undefined>)[name.toLowerCase()];
      return Array.isArray(val) ? val[0] : val;
    }

    get cookies(): RequestCookiesImpl {
      if (!this._zreqCookies)
        this._zreqCookies = new RequestCookiesImpl(parseCookieHeader(this.headers));
      return this._zreqCookies;
    }

    json<R>(): Promise<R> {
      return (this as any)
        .body()
        .then((b: Buffer) => JSON.parse(b.toString()) as R);
    }

    form<R>(): Promise<R> {
      const headers = this.headers;
      const contentType =
        typeof (headers as LacisHeaders).get === "function"
          ? ((headers as LacisHeaders).get("content-type") ?? "")
          : (((headers as Record<string, string | string[] | undefined>)["content-type"]) as string ?? "");

      if (contentType.startsWith("application/x-www-form-urlencoded")) {
        return (this as any)
          .body()
          .then((buffer: Buffer) =>
            Object.fromEntries(new URLSearchParams(buffer.toString())) as R,
          );
      }

      if (!contentType.startsWith("multipart/form-data")) {
        return Promise.reject(
          new Error(
            "Content-Type must be multipart/form-data or application/x-www-form-urlencoded",
          ),
        );
      }

      return new Promise((resolve, reject) => {
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
          reject(new Error("Boundary not found"));
          return;
        }
        const boundary = boundaryMatch[1].trim();

        (this as any)
          .body()
          .then((buffer: Buffer) => {
            const result: any = {};
            const delimiter = Buffer.from(`--${boundary}`);
            const parts: Buffer[] = [];
            let offset = 0,
              idx: number;
            while ((idx = buffer.indexOf(delimiter, offset)) !== -1) {
              parts.push(buffer.subarray(offset, idx));
              offset = idx + delimiter.length;
            }
            parts.push(buffer.subarray(offset));
            for (let i = 1; i < parts.length - 1; i++) {
              const content = parts[i].subarray(2);
              const sepIdx = content.indexOf("\r\n\r\n");
              if (sepIdx === -1) continue;
              const hdr = content.subarray(0, sepIdx).toString();
              const body = content.subarray(sepIdx + 4, content.length - 2);
              const d = hdr.match(
                /Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/i,
              );
              if (!d) continue;
              if (d[2]) {
                const m = hdr.match(/Content-Type:\s*([^\r\n]+)/i);
                result[d[1]] = {
                  filename: d[2],
                  mimetype: m ? m[1].trim() : "application/octet-stream",
                  data: body,
                  size: body.length,
                };
              } else {
                result[d[1]] = body.toString("utf-8");
              }
            }
            resolve(result as R);
          })
          .catch(reject);
      });
    }

    createSSEClient(
      options?: SSEClientOptions,
      handlers?: SSEEventHandlers,
    ): SSEClient {
      return createSSEClient(this as any, options, handlers) as SSEClient;
    }
  };
}

export function nodeBody(this: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const limit = this._maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  let size = 0,
    settled = false;
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        // Stop reading without destroying the socket, so the adapter can still
        // send a clean 413 response. Node closes the connection on its own once
        // the response ends with the request body left unconsumed.
        this.pause();
        this.removeListener("data", onData);
        reject(Object.assign(new Error("Payload Too Large"), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    };
    this.on("data", onData)
      .on("end", () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      })
      .on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
  });
}

// Response mixin

export type ResponseMixinBase = new (...args: any[]) => {
  statusCode: number;
  headersSent: boolean;
  setHeader(name: string, value: string | readonly string[]): any;
  end(data?: any): any;
  write(chunk: any): any;
};

function flushCookies(jar: ResponseCookiesImpl, res: { headersSent: boolean; setHeader(n: string, v: string | readonly string[]): any }): void {
  const serialized = jar.serialize();
  if (serialized.length > 0 && !res.headersSent)
    res.setHeader('Set-Cookie', serialized);
}

export function withResponseMethods<T extends ResponseMixinBase>(Base: T) {
  return class extends Base {
    _zresCookies?: ResponseCookiesImpl;

    get cookies(): ResponseCookiesImpl {
      if (!this._zresCookies) this._zresCookies = new ResponseCookiesImpl();
      return this._zresCookies;
    }

    end(data?: any): any {
      if (this._zresCookies) flushCookies(this._zresCookies, this);
      return super.end(data);
    }

    status(code: number) {
      this.statusCode = code;
      return this;
    }

    send(data: any) {
      if (typeof data === "string") {
        this.setHeader("Content-Type", "text/plain");
        this.end(data);
      } else {
        this.json(data);
      }
      return this;
    }

    json(data: any) {
      this.setHeader("Content-Type", "application/json");
      this.end(JSON.stringify(data));
      return this;
    }

    html(data: string) {
      this.setHeader("Content-Type", "text/html; charset=utf-8");
      this.end(data);
      return this;
    }

    redirect(url: string, status = 302) {
      this.statusCode = status;
      this.setHeader("Location", url);
      this.end();
      return this;
    }

    initSSE(options?: SSEOptions) {
      return initSSE(this as any, options);
    }

    async stream(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<void> {
      this.setHeader('Cache-Control', 'no-cache')
      this.setHeader('X-Accel-Buffering', 'no')
      if (body instanceof ReadableStream) {
        const reader = (body as ReadableStream<Uint8Array>).getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            this.write(value)
          }
        } finally {
          this.end()
        }
      } else {
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          this.write(chunk)
        }
        this.end()
      }
    }

    async ndjson(iter: AsyncIterable<unknown>): Promise<void> {
      const encoder = new TextEncoder()
      this.setHeader('Content-Type', 'application/x-ndjson')
      this.setHeader('Cache-Control', 'no-cache')
      this.setHeader('X-Accel-Buffering', 'no')
      for await (const item of iter) {
        this.write(encoder.encode(JSON.stringify(item) + '\n'))
      }
      this.end()
    }
  };
}

// Prototype extraction for serverless adapters (Vercel/Netlify)
// Note: end() is intentionally NOT copied — applyResponseMethods wraps it per-instance
class _ReqBase {
  params: Record<string, string> = {};
  headers: LacisHeaders | Record<string, string | string[] | undefined> = {};
  body() { return nodeBody.call(this); }
}
const _reqProto = withRequestMethods(_ReqBase).prototype;

class _ResBase {
  statusCode = 200;
  headersSent = false;
  setHeader(_n: string, _v: string | readonly string[]): any {}
  end(_d?: any): any {}
  write(_c: any): any {}
}
const _resProto = withResponseMethods(_ResBase).prototype;

export function applyRequestMethods(req: any): void {
  req.body = nodeBody;
  req.json = _reqProto.json;
  req.form = _reqProto.form;
  req.getHeader = _reqProto.getHeader;
  req.createSSEClient = _reqProto.createSSEClient;
  req.cookies = new RequestCookiesImpl(parseCookieHeader(req.headers));
  req.locals = {};
  req.platform = {};
}

export function extractPathname(url: string): string {
  const idx = url.indexOf("?");
  return idx === -1 ? url : url.slice(0, idx);
}

export function parseQueryString(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)).entries());
}

export async function handleAdapterError(req: Request, res: Response, error: unknown): Promise<void> {
  const httpError = isHttpError(error) ? error : normalizeError(error);
  if (httpError.log) console.error("[lacis] Error:", error);
  if (hasMiddlewares()) await runMiddlewares("onError", req, res, { error: httpError });
  if (!res.headersSent) sendError(httpError, res);
}

export function applyResponseMethods(res: any): void {
  const p = _resProto;
  res.status = p.status;
  res.send = p.send;
  res.json = p.json;
  res.html = p.html;
  res.redirect = p.redirect;
  res.initSSE = p.initSSE;

  const cookieJar = new ResponseCookiesImpl();
  res.cookies = cookieJar;

  const origEnd = res.end.bind(res);
  res.end = function(this: any, ...args: any[]) {
    flushCookies(cookieJar, this);
    return origEnd(...args);
  };

  // Buffered streaming for serverless — response is sent as a single body once the stream ends
  res.stream = async function(this: any, body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>) {
    const chunks: Uint8Array[] = []
    if (body instanceof ReadableStream) {
      const reader = (body as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
    } else {
      for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk)
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    const buf = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { buf.set(c, offset); offset += c.length }
    this.end(Buffer.from(buf))
  }

  res.ndjson = async function(this: any, iter: AsyncIterable<unknown>) {
    this.setHeader('Content-Type', 'application/x-ndjson')
    const parts: string[] = []
    for await (const item of iter) parts.push(JSON.stringify(item) + '\n')
    this.end(parts.join(''))
  }
}