import type { Request, Response } from 'zeno';

export const beforeRequest = async (req: Request, res: Response) => {
  console.log(`[API] Request: ${req.method} ${req.url}`);
  res.setHeader('X-API-Middleware', 'true');
  return true;
};

export const afterRequest = async (_req: Request, res: Response) => {
  console.log(`[API] Response sent with status: ${res.statusCode}`);
};
