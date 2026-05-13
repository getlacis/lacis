import type { Request, Response } from 'zeno';

export const GET = async (_req: Request, res: Response) => {
  res.send("Hello World!");
};
