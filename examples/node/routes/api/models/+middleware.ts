import type { Request, Response } from "@/types";

export const beforeRequest = async (req: Request, res: Response) => {
  console.log(`[API] Request2: ${req.method} ${req.url}`);
  
  res.setHeader('X-API-Middleware2', 'true');
  
  return true;
};

export const afterRequest = async (req: Request, res: Response) => {
  console.log(`[API] Response sent with status2: ${res.statusCode}`);
};