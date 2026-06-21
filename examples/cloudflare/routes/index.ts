import type { Request, Response } from 'lacis'

export async function GET(_req: Request, res: Response) {
  res.status(200).json({ message: 'Hello from lacis on Cloudflare Workers!' })
}
