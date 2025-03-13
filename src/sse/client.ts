import { IncomingMessage } from "http";
import http from "http";
import https from "https";
import type {
  SSEClientOptions,
  SSEEventHandlers,
  SSEClient,
} from "@/types/index";

/**
 * Creates a Server-Sent Events (SSE) client that can handle both URL connections and existing SSE streams
 * @param urlOrReq - URL to connect to or an existing IncomingMessage
 * @param options - Configuration options for the SSE client
 * @param handlers - Event handlers for the SSE connection
 * @param req - Optional IncomingMessage to inherit headers from
 * @returns A Promise resolving to an SSE client for URL connections, or an SSE client directly for existing connections
 */
export function createSSEClient(
  urlOrReq: string | IncomingMessage,
  options: SSEClientOptions = {},
  handlers: SSEEventHandlers = {},
  req?: IncomingMessage
): Promise<SSEClient> | SSEClient {
  // State management
  let isConnected = false;
  let retryCount = 0;
  const eventHandlers: Record<string, ((data: any) => void)[]> = {};
  const messageHandlers: ((data: any) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const errorHandlers: ((error: Error) => void)[] = [];
  let request: http.ClientRequest | null = null;

  // Initialize handlers from options
  if (handlers.onMessage) messageHandlers.push(handlers.onMessage);
  if (handlers.onClose) closeHandlers.push(handlers.onClose);
  if (handlers.onError) errorHandlers.push(handlers.onError);
  if (handlers.onEvent) {
    Object.entries(handlers.onEvent).forEach(([event, handler]) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
    });
  }

  // Extract options with defaults
  const reconnectInterval = options.reconnectInterval || 3000;
  const maxRetries = options.maxRetries || 3;
  const disableReconnect = options.disableReconnect || false;
  const requestBody = options.body;
  const contentType = options.contentType || (requestBody ? 'application/json' : undefined);
  // Si la méthode n'est pas spécifiée, utiliser POST si un corps est fourni, sinon GET
  const method = options.method || (requestBody ? "POST" : "GET");

  // If first argument is a request object, treat it as an existing SSE connection
  if (typeof urlOrReq !== "string") {
    const existingReq = urlOrReq;
    isConnected = true;

    existingReq.on("data", (chunk: string) => {
      handleSSEData(chunk.toString());
    });

    existingReq.on("end", () => {
      isConnected = false;
    });

    existingReq.on("error", (error) => {
      isConnected = false;
      console.error("SSE Error:", error);
    });

    return createClientInterface();
  }

  // Pour les connexions avec URL, retourner une promesse pour permettre une utilisation async/await
  if (typeof urlOrReq === "string") {
    return new Promise((resolve, reject) => {
      startListening()
        .then(() => resolve(createClientInterface()))
        .catch(reject);
    });
  }

  // Parses incoming SSE data chunks and triggers appropriate handlers
  function handleSSEData(chunk: string) {
    let buffer = chunk;
    const messages = buffer.split("\n\n"); // Split into individual SSE messages
    buffer = messages.pop() || ""; // Store incomplete message for next chunk

    for (const message of messages) {
      const lines = message.split("\n");
      let data = "";
      let currentEvent = "";

      // Parse SSE message format (event: and data: fields)
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim();
        }
      }

      if (data) {
        try {
          // Attempt to parse JSON data
          const parsedData = JSON.parse(data);
          if (currentEvent && eventHandlers[currentEvent]) {
            // Trigger named event handlers
            eventHandlers[currentEvent].forEach((handler) =>
              handler(parsedData)
            );
          } else {
            // Trigger generic message handlers
            messageHandlers.forEach((handler) => handler(parsedData));
          }
        } catch {
          // If JSON parsing fails, send raw data
          if (currentEvent && eventHandlers[currentEvent]) {
            eventHandlers[currentEvent].forEach((handler) => handler(data));
          } else {
            messageHandlers.forEach((handler) => handler(data));
          }
        }
      }
    }
  }

  // Creates the public interface for interacting with the SSE client
  function createClientInterface(): SSEClient {
    return {
      // Register handler for all messages
      onMessage(callback: (data: any) => void) {
        messageHandlers.push(callback);
        return this;
      },

      // Register handler for specific named events
      onEvent(eventName: string, callback: (data: any) => void) {
        if (!eventHandlers[eventName]) {
          eventHandlers[eventName] = [];
        }
        eventHandlers[eventName].push(callback);
        return this;
      },

      // Register handler for connection close
      onClose(callback: () => void) {
        closeHandlers.push(callback);
        return this;
      },

      // Manually close the connection
      close() {
        if (request) {
          request.destroy();
          request = null;
        }
        isConnected = false;
        closeHandlers.forEach((handler) => handler());
      },
    };
  }

  // Establishes the SSE connection to the server
  async function startListening() {
    if (isConnected) return;
    isConnected = true;

    try {
      await connect();
    } catch (error) {
      if (!disableReconnect && retryCount < maxRetries) {
        retryCount++;
        setTimeout(() => {
          startListening();
        }, reconnectInterval);
      } else {
        errorHandlers.forEach((handler) => handler(error as Error));
      }
    }
  }

  async function connect() {
    return new Promise((resolve, reject) => {
      // Configure HTTP/HTTPS request options
      const parsedUrl = new URL(urlOrReq as string);
      
      // Ajouter les paramètres de requête s'ils sont fournis
      if (options.params) {
        // Si params est un objet
        if (typeof options.params === 'object') {
          Object.entries(options.params).forEach(([key, value]) => {
            parsedUrl.searchParams.append(key, String(value));
          });
        } 
        // Si params est une chaîne
        else if (typeof options.params === 'string') {
          const searchParams = new URLSearchParams(options.params);
          searchParams.forEach((value, key) => {
            parsedUrl.searchParams.append(key, value);
          });
        }
      }
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method, // Utiliser la méthode définie plus haut
        headers: {
          Accept: "text/event-stream",
          ...(req?.headers || {}),
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...(contentType && { "Content-Type": contentType }),
          ...(requestBody && typeof requestBody === "string" && 
              { "Content-Length": Buffer.byteLength(requestBody).toString() }),
          ...(requestBody && typeof requestBody !== "string" && 
              { "Content-Length": Buffer.byteLength(JSON.stringify(requestBody)).toString() })
        },
      };

      // Create appropriate client based on protocol
      const client = parsedUrl.protocol === "https:" ? https : http;
      request = client.request(requestOptions, (response) => {
        // Handle non-200 responses
        if (response.statusCode !== 200) {
          isConnected = false;
          reject(
            new Error(`Server responded with status: ${response.statusCode}`)
          );
          return;
        }

        response.setEncoding("utf8");
        response.on("data", handleSSEData);

        // Clean up on various connection end scenarios
        response.on("end", () => {
          isConnected = false;
          request?.destroy();
          request = null;
          closeHandlers.forEach((handler) => handler());
          resolve(null);
        });
        response.on("close", () => {
          isConnected = false;
          request?.destroy();
          request = null;
          closeHandlers.forEach((handler) => handler());
          resolve(null);
        });
        response.on("error", (error) => {
          isConnected = false;
          request?.destroy();
          request = null;
          closeHandlers.forEach((handler) => handler());
          reject(error);
        });
      });

      // Handle request errors
      request.on("error", (error) => {
        isConnected = false;
        request?.destroy();
        request = null;
        reject(error);
      });

      // Envoyer le corps de la requête si présent
      if (requestBody) {
        if (typeof requestBody === "string") {
          request.write(requestBody);
        } else {
          request.write(JSON.stringify(requestBody));
        }
      }

      request.end();
    });
  }

  return createClientInterface();
}
