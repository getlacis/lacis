import { IncomingMessage, ServerResponse } from "http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const { model } = (req as any).params;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: `Model: ${model}` }));
}