import { IncomingMessage, ServerResponse } from "http";
import type {
  SSEClient,
  SSEClientOptions,
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
  send(data: any): void;
  status(code: number): Response;
  initSSE(options?: SSEOptions): void;
  sseSend(data: string): void;
  sseJson(data: any): void;
  sseEvent(event: string, data: any): void;
  sseComment(comment: string): void;
  sseId(id: string): void;
  sseRetry(ms: number): void;
  sseClose(comment?: string): void;
  sseError(event: string, error: string, code?: number, details?: string): void;
}

export type { Request, Response, UploadedFile, CookieOptions, RequestCookies, ResponseCookies };
