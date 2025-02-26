import type { Request, Response } from "@/types";

export const beforeRequest = async (req: Request, res: Response) => {
  console.log(`[ROOT] Request: ${req.method} ${req.url}`);
  
  //res.setHeader('X-Root-Middleware', 'true');
  
  return true;
};

export const afterRequest = async (req: Request, res: Response) => {
  console.log(`[ROOT] Response sent with status: ${res.statusCode}`);
};