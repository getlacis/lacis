import { IncomingMessage, ServerResponse } from "http";
import {
  initSSE,
  send,
  sendEvent,
  sseComment,
  sseId,
  sseRetry,
  sseClose,
  sseEventError,
  sendJson,
} from "@/sse/server";
import { createSSEClient } from "@/sse/client";
import type {
  SSEOptions,
  SSEClientOptions,
  SSEEventHandlers,
  Response,
  Request,
  SSEClient,
} from "@/types";

function enhanceRequest(req: IncomingMessage): Request {
  const enhanced = req as Request;

  enhanced.createSSEClient = function (
    options?: SSEClientOptions,
    handlers?: SSEEventHandlers
  ): SSEClient {
    return createSSEClient(this, options, handlers) as SSEClient;
  };

  enhanced.bindJSON = function <T>(): Promise<T> {
    return this.body().then((buffer) => JSON.parse(buffer.toString()));
  }

  enhanced.bindForm = function <T>(): Promise<T> {
    return new Promise((resolve, reject) => {
      let contentType = this.headers['content-type'];

      if (!contentType || !contentType.startsWith('multipart/form-data')) {
        reject(new Error('Content-Type is not multipart/form-data'));
        return;
      }

      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (!boundaryMatch) {
        reject(new Error('Boundary not found in Content-Type'));
        return;
      }

      const boundary = boundaryMatch[1].trim();

      this.body()
        .then(buffer => {
          const bodyString = buffer.toString();
          const parts = bodyString.split(boundary).slice(1, -1);

          const result: any = {};

          for (const part of parts) {
            const contentDispositionMatch = part.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);

            if (contentDispositionMatch) {
              const fieldName = contentDispositionMatch[1];
              const filename = contentDispositionMatch[2];
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              const value = part.substring(valueStart, valueEnd);

              if (filename) {
                // TODO: Handle file upload
              } else {
                result[fieldName] = value.trim();
              }
            }
          }

          resolve(result as T);
        })
        .catch(reject);
    });
  }

  enhanced.body = function (): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      this.on("data", (chunk: Buffer) => chunks.push(chunk))
          .on("end", () => resolve(Buffer.concat(chunks)))
          .on("error", reject);
    });
  };

  return enhanced;
}

function enhanceResponse(res: ServerResponse): Response {
  const enhanced = res as Response;

  enhanced.json = function (data: any) {
    this.setHeader("Content-Type", "application/json");
    this.end(JSON.stringify(data));
  };

  enhanced.send = function (data: any) {
    if (typeof data === "string") {
      this.setHeader("Content-Type", "text/plain");
      this.end(data);
    } else {
      this.json(data);
    }
  };

  enhanced.status = function (code: number) {
    this.statusCode = code;
    return this;
  };

  enhanced.initSSE = function (options?: SSEOptions) {
    initSSE(this, options);
  };

  enhanced.sseSend = function (data: string) {
    send(this, data);
  };

  enhanced.sseJson = function (data: any) {
    sendJson(this, JSON.stringify(data));
  };

  enhanced.sseEvent = function (event: string, data: any) {
    sendEvent(this, event, data);
  };

  enhanced.sseComment = function (comment: string) {
    sseComment(this, comment);
  };

  enhanced.sseId = function (id: string) {
    sseId(this, id);
  };

  enhanced.sseRetry = function (ms: number) {
    sseRetry(this, ms);
  };

  enhanced.sseClose = function (comment?: string) {
    sseClose(this, comment);
  };

  enhanced.sseError = function (
    event: string,
    error: string,
    code = 500,
    details?: string
  ) {
    sseEventError(this, event, error, code, details);
  };

  return enhanced;
}

export { enhanceRequest, enhanceResponse };
