import type { Request, Response } from 'lacis';

export async function GET(_req: Request, res: Response) {
  res.status(200).json({ message: "Get all users" });
}

export async function POST(_req: Request, res: Response) {
  res.status(201).json({ message: "Create new user" });
}

export async function PUT(_req: Request, res: Response) {
  res.status(200).json({ message: "Update user" });
}

export async function DELETE(_req: Request, res: Response) {
  res.status(200).json({ message: "Delete user" });
}
