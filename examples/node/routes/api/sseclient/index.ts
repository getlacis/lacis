import { createSSEClient } from 'zeno';
import type { Request, Response } from 'zeno';

export async function GET(_req: Request, res: Response) {
  res.initSSE();

  const client = await createSSEClient("http://localhost:3000/api/updates");

  client
    .onMessage(data => {
      res.sseSend(data);
    })
    .onEvent("userUpdate", data => {
      res.sseEvent("userUpdate", data);
    })
    .onClose(() => {
      res.sseClose();
    });
}
