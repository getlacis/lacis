import { IncomingMessage, ServerResponse } from "http";
import type {
  SSEClient,
  SSEClientOptions,
  SSEContext,
  SSEEventHandlers,
  SSEOptions,
} from "./";

interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

interface RequestCookies {
  get(name: string): string | undefined;
  all(): Record<string, string>;
}

interface ResponseCookies {
  set(name: string, value: string, options?: CookieOptions): ResponseCookies;
  delete(name: string, options?: Pick<CookieOptions, 'path' | 'domain'>): ResponseCookies;
}

interface UploadedFile {
  filename: string;
  mimetype: string;
  data: Buffer;
  size: number;
}

// Augmentable via declaration merging. By default `locals` is empty; enrich it in
// your app with `declare module 'lacis' { interface Locals { user: ... } }`.
// `locals` is global (visible on every route, even without auth) — a deliberate
// trade-off for file-based routing. Per-route inference comes with `use:`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Locals {}

// Augmentable via declaration merging. Empty by default, so on a node project
// `req.platform` exposes nothing. The Cloudflare scaffold's env.d.ts injects the
// shape ({ env, ctx, cf }). The name `platform` and its augmentability are frozen
// for semver; the contents are free (injected by the scaffold).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface PlatformContext {}

interface Request extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  cookies: RequestCookies;
  locals: Locals;
  platform: PlatformContext;
  getHeader(name: string): string | undefined;
  createSSEClient(
    options?: SSEClientOptions,
    handlers?: SSEEventHandlers
  ): SSEClient;
  json<T>(): Promise<T>;
  form<T>(): Promise<T>;
  body(): Promise<Buffer>;
}

interface Response extends ServerResponse {
  headers?: Record<string, string>;
  body?: any;
  cookies: ResponseCookies;

  json(data: any): void;
  html(data: string): void;
  redirect(url: string, status?: number): void;
  send(data: any): void;
  status(code: number): Response;
  initSSE(options?: SSEOptions): SSEContext;
  stream(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<void>;
  ndjson(iter: AsyncIterable<unknown>): Promise<void>;
}

export type { Request, Response, UploadedFile, CookieOptions, RequestCookies, ResponseCookies, Locals, PlatformContext };
