import type { Request, Response } from "@/types";
import { initSSE, send, sendEvent, sseClose } from "../../../src/sse/server";
import type { IncomingMessage, ServerResponse } from "http";

export async function GET(req: Request, res: Response) {
  res.initSSE();
  
  console.log("Sending regular updates");
  res.send({ status: "connected" });
  
  res.sseEvent("userUpdate", { id: 1, name: "John" });
  res.sseClose();

}