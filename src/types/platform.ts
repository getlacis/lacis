import type { Server } from "http";
import type { ServerConfig } from ".";
import type { AdapterRequest, AdapterResponse } from "./adapter";

interface VercelRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string>;
  body?: any;
  query?: Record<string, string | string[]>;
}

interface VercelResponse {
  statusCode?: number;
  headersSent: boolean;
  status: (statusCode: number) => VercelResponse;
  json: (body: any) => VercelResponse;
  send: (body: any) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
  setHeader: (name: string, value: string | string[]) => VercelResponse;
  getHeader: (name: string) => string | string[] | undefined;
  end: (data?: any) => void;
}

interface NetlifyEvent {
  rawUrl: string;
  rawQuery: string;
  path: string;
  httpMethod: string;
  headers: Record<string, string | undefined>;
  multiValueHeaders: Record<string, string[] | undefined>;
  queryStringParameters: Record<string, string | undefined> | null;
  multiValueQueryStringParameters: Record<string, string[] | undefined> | null;
  body: string | null;
  isBase64Encoded: boolean;
  route?: string;
}

interface NetlifyContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  identity?: Record<string, any>;
  clientContext?: Record<string, any>;
  getRemainingTimeInMillis(): number;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, boolean | number | string>;
  multiValueHeaders?: Record<string, readonly (boolean | number | string)[]>;
  body?: string;
  isBase64Encoded?: boolean;
}

type NetlifyHandler = (
  event: NetlifyEvent,
  context: NetlifyContext
) => Promise<NetlifyResponse>;

type PlatformHandler =
  | ((config?: ServerConfig) => Server)
  | ((req: AdapterRequest, res: AdapterResponse) => Promise<void>)
  | ((event: NetlifyEvent, context: NetlifyContext) => Promise<NetlifyResponse>);

export type {
  VercelRequest,
  VercelResponse,
  NetlifyEvent,
  NetlifyContext,
  NetlifyResponse,
  NetlifyHandler,
  PlatformHandler,
};
