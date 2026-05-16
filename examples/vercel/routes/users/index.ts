import type { Request, Response } from 'lacis'

const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]

export async function GET(_req: Request, res: Response) {
  res.status(200).json(users)
}

export async function POST(req: Request, res: Response) {
  const body = await req.bindJSON<{ name: string }>()
  const user = { id: users.length + 1, name: body.name }
  users.push(user)
  res.status(201).json(user)
}
