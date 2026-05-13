import type { Request, Response } from 'zeno';

export async function GET(_req: Request, res: Response) {
  res.initSSE();

  console.log("Sending regular updates");
  res.sseSend(JSON.stringify({ status: "connected" }));

  res.sseEvent("userUpdate", { id: 1, name: "John" });
  res.sseClose();
}
