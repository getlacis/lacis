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
} from "@/sse/server";
import { createSSEClient } from "@/sse/client";
import type {
  SSEOptions,
  SSEClientOptions,
  SSEEventHandlers,
  Response,
  Request,
} from "@/types";

function enhanceRequest(req: IncomingMessage): Request {
  const enhanced = req as Request;

  enhanced.createSSEClient = function (
    options?: SSEClientOptions,
    handlers?: SSEEventHandlers
  ) {
    return createSSEClient(this, options, handlers);
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

  enhanced.sseSend = function (data: any) {
    send(this, data);
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