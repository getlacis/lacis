import type { Request, Response } from 'zeno'

const users: Record<string, { id: number; name: string }> = {
  '1': { id: 1, name: 'Alice' },
  '2': { id: 2, name: 'Bob' },
}

export async function GET(req: Request, res: Response) {
  const user = users[req.params!.id]
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.status(200).json(user)
}

export async function DELETE(req: Request, res: Response) {
  const { id } = req.params!
  if (!users[id]) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  delete users[id]
  res.status(204).end()
}
