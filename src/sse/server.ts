import { ServerResponse } from "http";
import type { SSEOptions } from "@/types/index";

export function initSSE(res: ServerResponse, options?: SSEOptions) {
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
  // If it was me I would not do this to keep it simple and optimized
  setTimeout(() => {
    res.end();
  }, timeout);
}

export function send(res: ServerResponse, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sendEvent(res: ServerResponse, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseComment(res: ServerResponse, comment: string) {
  res.write(`: ${comment}\n\n`);
}

export function sseId(res: ServerResponse, id: string) {
  res.write(`id: ${id}\n\n`);
}

export function sseRetry(res: ServerResponse, ms: number) {
  res.write(`retry: ${ms}\n\n`);
}

export function sseClose(
  res: ServerResponse,
  comment: string = "Fin de la connexion SSE"
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
