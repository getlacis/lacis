import type { Request, Response } from 'lacis';

export async function GET(req: Request, res: Response) {
  res.status(200).json({ message: `Model: ${req.params!.model}` });
}
