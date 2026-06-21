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

interface Request extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  cookies: RequestCookies;
  env?: unknown;
  ctx?: unknown;
  cf?: unknown;
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

export type { Request, Response, UploadedFile, CookieOptions, RequestCookies, ResponseCookies };
