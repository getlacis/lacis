import { IncomingMessage, ServerResponse } from "http";
import type {
  SSEClient,
  SSEClientOptions,
  SSEEventHandlers,
  SSEOptions,
} from "./";

interface Request extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  createSSEClient(
    options?: SSEClientOptions,
    handlers?: SSEEventHandlers
  ): SSEClient;
}

interface Response extends ServerResponse {
  json(data: any): void;
  send(data: any): void;
  status(code: number): Response;
  initSSE(options?: SSEOptions): void;
  sseSend(data: any): void;
  sseEvent(event: string, data: any): void;
  sseComment(comment: string): void;
  sseId(id: string): void;
  sseRetry(ms: number): void;
  sseClose(comment?: string): void;
  sseError(event: string, error: string, code?: number, details?: string): void;
}

export type { Request, Response };
