interface SSEOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

interface SSEClientOptions {
  reconnectInterval?: number;
  maxRetries?: number;
  body?: string | Record<string, any>;
  contentType?: string;
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

export type { SSEOptions, SSEClientOptions, SSEEventHandlers, SSEClient };
