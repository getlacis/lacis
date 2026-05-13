import type { Request, Response } from 'zeno';

export const beforeRequest = (req: Request, res: Response) => {
  res.setHeader("X-Root-Middleware", "true");

  if (process.env.NODE_ENV === "development") {
    console.log(`[ROOT] Request: ${req.method} ${req.url}`);
  }

  return true;
};

export const afterRequest = (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[ROOT] Response sent with status: ${res.statusCode}`);
  }
  return true;
};
