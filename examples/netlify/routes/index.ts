import type { Request, Response } from 'zeno'

export async function GET(_req: Request, res: Response) {
  res.status(200).json({ message: 'Welcome to zeno on Netlify!' })
}
