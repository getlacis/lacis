import type { Request, Response } from 'lacis';

export const GET = async (_req: Request, res: Response) => {
  res.send("Hello World!");
};
