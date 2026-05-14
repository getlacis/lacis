import { createSSEClient } from "@/sse/client";
import {
  initSSE,
  send,
  sendEvent,
  sendJson,
  sseClose,
  sseComment,
  sseEventError,
  sseId,
  sseRetry,
} from "@/sse/server";
import type {
  SSEClient,
  SSEClientOptions,
  SSEEventHandlers,
  SSEOptions,
} from "@/types";

const MAX_BODY_SIZE = 10_485_760; // 10 MB

export interface ZenoHeaders {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(cb: (value: string, key: string) => void): void;
}

export type RequestMixinBase = new (...args: any[]) => {
  params: Record<string, string>;
};

export function withRequestMethods<T extends RequestMixinBase>(Base: T) {
  return class extends Base {
    json<R>(): Promise<R> {
      return (this as any)
        .body()
        .then((b: Buffer) => JSON.parse(b.toString()) as R);
    }

    form<R>(): Promise<R> {
      return new Promise((resolve, reject) => {
        const headers = (this as any).headers as
          | ZenoHeaders
          | Record<string, string | string[] | undefined>;
        const contentType =
          typeof (headers as any).get === "function"
            ? ((headers as ZenoHeaders).get("content-type") ?? "")
            : (((headers as any)["content-type"] as string) ?? "");

        if (!contentType.startsWith("multipart/form-data")) {
          reject(new Error("Content-Type is not multipart/form-data"));
          return;
        }
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
          reject(new Error("Boundary not found"));
          return;
        }
        const boundary = boundaryMatch[1].trim();

        (this as any)
          .body()
          .then((buffer: Buffer) => {
            const result: any = {};
            const delimiter = Buffer.from(`--${boundary}`);
            const parts: Buffer[] = [];
            let offset = 0,
              idx: number;
            while ((idx = buffer.indexOf(delimiter, offset)) !== -1) {
              parts.push(buffer.subarray(offset, idx));
              offset = idx + delimiter.length;
            }
            parts.push(buffer.subarray(offset));
            for (let i = 1; i < parts.length - 1; i++) {
              const content = parts[i].subarray(2);
              const sepIdx = content.indexOf("\r\n\r\n");
              if (sepIdx === -1) continue;
              const hdr = content.subarray(0, sepIdx).toString();
              const body = content.subarray(sepIdx + 4, content.length - 2);
              const d = hdr.match(
                /Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/i,
              );
              if (!d) continue;
              if (d[2]) {
                const m = hdr.match(/Content-Type:\s*([^\r\n]+)/i);
                result[d[1]] = {
                  filename: d[2],
                  mimetype: m ? m[1].trim() : "application/octet-stream",
                  data: body,
                  size: body.length,
                };
              } else {
                result[d[1]] = body.toString("utf-8");
              }
            }
            resolve(result as R);
          })
          .catch(reject);
      });
    }

    createSSEClient(
      options?: SSEClientOptions,
      handlers?: SSEEventHandlers,
    ): SSEClient {
      return createSSEClient(this as any, options, handlers) as SSEClient;
    }
  };
}

export function nodeBody(this: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0,
    settled = false;
  return new Promise((resolve, reject) => {
    this.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        settled = true;
        this.destroy();
        reject(Object.assign(new Error("Payload Too Large"), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    })
      .on("end", () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      })
      .on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
  });
}

export type ResponseMixinBase = new (...args: any[]) => {
  statusCode: number;
  headersSent: boolean;
  setHeader(name: string, value: string): any;
  end(data?: any): any;
  write(chunk: any): any;
};

export function withResponseMethods<T extends ResponseMixinBase>(Base: T) {
  return class extends Base {
    status(code: number) {
      this.statusCode = code;
      return this;
    }

    send(data: any) {
      if (typeof data === "string") {
        this.setHeader("Content-Type", "text/plain");
        this.end(data);
      } else {
        this.json(data);
      }
      return this;
    }

    json(data: any) {
      this.setHeader("Content-Type", "application/json");
      this.end(JSON.stringify(data));
      return this;
    }

    initSSE(options?: SSEOptions) {
      return initSSE(this as any, options);
    }
    sseSend(data: string) {
      send(this as any, data);
    }
    sseJson(data: any) {
      sendJson(this as any, data);
    }
    sseEvent(event: string, data: any) {
      sendEvent(this as any, event, data);
    }
    sseComment(comment: string) {
      sseComment(this as any, comment);
    }
    sseId(id: string) {
      sseId(this as any, id);
    }
    sseRetry(ms: number) {
      sseRetry(this as any, ms);
    }
    sseClose(comment?: string) {
      sseClose(this as any, comment);
    }
    sseError(event: string, error: string, code = 500, details?: string) {
      sseEventError(this as any, event, error, code, details);
    }
  };
}

// Instantiate dummy classes once to extract prototype methods, avoiding closure allocation on every serverless invocation
class _ReqBase {
  params: Record<string, string> = {};
  body() {
    return nodeBody.call(this);
  }
}
const _reqProto = withRequestMethods(_ReqBase).prototype;

class _ResBase {
  statusCode = 200;
  headersSent = false;
  setHeader(_n: string, _v: string): any {}
  end(_d?: any): any {}
  write(_c: any): any {}
}
const _resProto = withResponseMethods(_ResBase).prototype;

export function applyRequestMethods(req: any): void {
  req.body = nodeBody;
  req.json = _reqProto.json;
  req.form = _reqProto.form;
  req.createSSEClient = _reqProto.createSSEClient;
}

export function applyResponseMethods(res: any): void {
  const p = _resProto;
  res.status = p.status;
  res.send = p.send;
  res.json = p.json;
  res.initSSE = p.initSSE;
  res.sseSend = p.sseSend;
  res.sseJson = p.sseJson;
  res.sseEvent = p.sseEvent;
  res.sseComment = p.sseComment;
  res.sseId = p.sseId;
  res.sseRetry = p.sseRetry;
  res.sseClose = p.sseClose;
  res.sseError = p.sseError;
}
