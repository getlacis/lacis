import type { Server } from "http";
import type { ServerConfig } from ".";
import type { AdapterRequest, AdapterResponse } from "./adapter";

interface VercelRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  query?: Record<string, string | string[]>;
}

interface VercelResponse {
  statusCode?: number;
  status: (statusCode: number) => VercelResponse;
  json: (body: any) => void;
  send: (body: any) => void;
  setHeader: (name: string, value: string) => void;
}

interface NetlifyEvent {
  path: string;
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface NetlifyContext {
  // Not used now, but needs functionName, functionVersion and awsRequestId
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type NetlifyHandler = (
  event: NetlifyEvent,
  context: NetlifyContext
) => Promise<NetlifyResponse>;

type PlatformHandler =
  | ((config?: ServerConfig) => Server) // Node
  | ((req: AdapterRequest, res: AdapterResponse) => Promise<void>) // Vercel
  | ((
      event: NetlifyEvent,
      context: NetlifyContext
    ) => Promise<{
      // Netlify
      statusCode: number;
      body: string;
      headers?: Record<string, string>;
    }>);

export type {
  VercelRequest,
  VercelResponse,
  NetlifyEvent,
  NetlifyContext,
  NetlifyResponse,
  NetlifyHandler,
  PlatformHandler,
};
