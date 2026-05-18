import { ServerResponse } from "http";
import type { SSEOptions } from "@/types/index";

interface ResLike {
  readonly writableEnded: boolean;
  write(chunk: any): any;
  end(data?: any): any;
  writeHead(code: number, headers?: Record<string, string>): any;
  on(event: string, cb: () => void): any;
}

export class SSEContext {
  private _timeoutId: ReturnType<typeof setTimeout>;

  constructor(private _res: ResLike, timeout: number) {
    this._timeoutId = setTimeout(() => _res.end(), timeout);
    _res.on("close", () => clearTimeout(this._timeoutId));
  }

  send(data: string): boolean {
    if (this._res.writableEnded) return false;
    return this._res.write(`data: ${data}\n\n`);
  }

  json(data: any): boolean {
    if (this._res.writableEnded) return false;
    return this._res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  event(event: string, data: any): boolean {
    if (this._res.writableEnded) return false;
    this._res.write(`event: ${event}\n`);
    return this._res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  comment(text: string): boolean {
    if (this._res.writableEnded) return false;
    return this._res.write(`: ${text}\n\n`);
  }

  id(id: string): boolean {
    if (this._res.writableEnded) return false;
    return this._res.write(`id: ${id}\n\n`);
  }

  retry(ms: number): boolean {
    if (this._res.writableEnded) return false;
    return this._res.write(`retry: ${ms}\n\n`);
  }

  close(comment: string = "Connection closed"): void {
    clearTimeout(this._timeoutId);
    this._res.write(`: ${comment}\n\n`);
    this._res.end();
  }

  error(event: string, message: string, code = 500, details?: string): void {
    clearTimeout(this._timeoutId);
    this._res.write(`event: ${event}\n`);
    this._res.write(`data: ${JSON.stringify({ message, code, details: details ?? null })}\n\n`);
    this._res.end();
  }
}

export function initSSE(res: ServerResponse, options?: SSEOptions): SSEContext {
  const cacheControl = options?.headers?.["Cache-Control"] ?? "no-cache";
  const connection = options?.headers?.["Connection"] ?? "keep-alive";
  const timeout = options?.timeout ?? 300000;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": cacheControl,
    Connection: connection,
    ...(options?.headers ?? {}),
  });

  return new SSEContext(res as any, timeout);
}
