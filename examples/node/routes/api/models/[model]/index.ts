import type { Request, Response } from 'zeno';

export async function GET(req: Request, res: Response) {
  res.status(200).json({ message: `Model: ${req.params!.model}` });
}
