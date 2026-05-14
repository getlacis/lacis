import { ServerResponse } from "http";
import type { SSEOptions } from "@/types/index";

export function initSSE(res: ServerResponse, options?: SSEOptions): ReturnType<typeof setTimeout> {
  const cacheControl = options?.headers?.["Cache-Control"] || "no-cache";
  const connection = options?.headers?.["Connection"] || "keep-alive";

  const timeout = options?.timeout || 300000;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": cacheControl,
    Connection: connection,
    ...(options?.headers || {}),
  });

  // Doing this to prevent users from keeping connections open indefinitely, which can cause memory leaks
  const timeoutId = setTimeout(() => {
    res.end();
  }, timeout);

  res.on('close', () => {
    clearTimeout(timeoutId);
  });

  return timeoutId;
}

export function send(res: ServerResponse, data: any): boolean {
  if (res.writableEnded) return false;
  return res.write(`data: ${data}\n\n`);
}

export function sendJson(res: ServerResponse, data: any): boolean {
  if (res.writableEnded) return false;
  return res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sendEvent(res: ServerResponse, event: string, data: any): boolean {
  if (res.writableEnded) return false;
  res.write(`event: ${event}\n`);
  return res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseComment(res: ServerResponse, comment: string): boolean {
  if (res.writableEnded) return false;
  return res.write(`: ${comment}\n\n`);
}

export function sseId(res: ServerResponse, id: string): boolean {
  if (res.writableEnded) return false;
  return res.write(`id: ${id}\n\n`);
}

export function sseRetry(res: ServerResponse, ms: number): boolean {
  if (res.writableEnded) return false;
  return res.write(`retry: ${ms}\n\n`);
}

export function sseClose(
  res: ServerResponse,
  comment: string = "Connection closed"
) {
  res.write(`: ${comment}\n\n`);
  res.end();
}

export function sseEventError(
  res: ServerResponse,
  event: string,
  error: string,
  code: number = 500,
  details?: string
) {
  res.writeHead(code, { "Content-Type": "text/event-stream" });
  res.write(`event: ${event}\n`);

  const errorData = {
    message: error,
    code: code,
    details: details || null,
  };

  res.write(`data: ${JSON.stringify(errorData)}\n\n`);
  res.end();
}
