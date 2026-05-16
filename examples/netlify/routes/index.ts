import type { Request, Response } from 'lacis'

export async function GET(_req: Request, res: Response) {
  res.status(200).json({ message: 'Welcome to lacis on Netlify!' })
}
