import type { Request, Response } from 'lacis'

export async function GET(req: Request, res: Response) {
  res.status(200).json({ id: req.params?.id })
}
