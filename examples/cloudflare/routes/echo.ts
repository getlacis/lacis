import type { Request, Response } from 'lacis'

export async function POST(req: Request, res: Response) {
  const body = await req.json<Record<string, unknown>>()
  res.status(200).json({ echo: body })
}
