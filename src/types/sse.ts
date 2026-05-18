interface SSEContext {
  send(data: string): boolean;
  json(data: any): boolean;
  event(event: string, data: any): boolean;
  comment(text: string): boolean;
  id(id: string): boolean;
  retry(ms: number): boolean;
  close(comment?: string): void;
  error(event: string, message: string, code?: number, details?: string): void;
}

interface SSEOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

interface SSEClientOptions {
  reconnectInterval?: number;
  maxRetries?: number;
  body?: string | Record<string, any>;
  contentType?: string;
  method?: "GET" | "POST" | "PUT";
  params?: string | Record<string, string>;
  disableReconnect?: boolean;
}

interface SSEEventHandlers {
  onMessage?: (data: any) => void;
  onEvent?: Record<string, (data: any) => void>;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

interface SSEClient {
  onMessage: (callback: (data: any) => void) => SSEClient;
  onEvent: (eventName: string, callback: (data: any) => void) => SSEClient;
  onClose: (callback: () => void) => SSEClient;
  close: () => void;
}

// All sse type event available

export type { SSEContext, SSEOptions, SSEClientOptions, SSEEventHandlers, SSEClient };
