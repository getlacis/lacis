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

// Default limit for request bodies. For large file uploads, thread a
// maxBodySize option through ServerConfig → adapter → enhanceRequest.
const MAX_BODY_SIZE = 10_485_760; // 10 MB

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let offset = 0;
  let idx: number;
  while ((idx = buf.indexOf(delimiter, offset)) !== -1) {
    parts.push(buf.subarray(offset, idx));
    offset = idx + delimiter.length;
  }
  parts.push(buf.subarray(offset));
  return parts;
}

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
      const contentType = this.headers['content-type'];

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
          const result: any = {};
          const delimiter = Buffer.from(`--${boundary}`);
          const parts = splitBuffer(buffer, delimiter);

          // parts[0] = preamble, parts[last] = "--\r\n" epilogue
          for (let i = 1; i < parts.length - 1; i++) {
            const part = parts[i];
            // Each part: \r\n<headers>\r\n\r\n<body>\r\n
            const content = part.subarray(2); // strip leading \r\n
            const sepIdx = content.indexOf('\r\n\r\n');
            if (sepIdx === -1) continue;

            const headers = content.subarray(0, sepIdx).toString('utf-8');
            const body = content.subarray(sepIdx + 4, content.length - 2); // strip trailing \r\n

            const dispositionMatch = headers.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/i);
            if (!dispositionMatch) continue;

            const fieldName = dispositionMatch[1];
            const filename = dispositionMatch[2];

            if (filename) {
              const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
              result[fieldName] = {
                filename,
                mimetype: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
                data: body,
                size: body.length,
              };
            } else {
              result[fieldName] = body.toString('utf-8');
            }
          }

          resolve(result as T);
        })
        .catch(reject);
    });
  }

  enhanced.body = function (): Promise<Buffer> {
    const stream = this as unknown as IncomingMessage;
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    return new Promise((resolve, reject) => {
      stream
        .on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_SIZE) {
            settled = true;
            stream.destroy();
            reject(Object.assign(new Error("Payload Too Large"), { code: 413 }));
            return;
          }
          chunks.push(chunk);
        })
        .on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } })
        .on("error", (err: Error) => { if (!settled) { settled = true; reject(err); } });
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
