import type { Request, Response } from "@/types";

export const GET = async (req: Request, res: Response) => {
  res.send("Hello World!");
};