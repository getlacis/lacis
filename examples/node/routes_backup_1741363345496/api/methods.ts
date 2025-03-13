import type { IncomingMessage, ServerResponse } from "http";

export async function GET(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Get all users" }));
  }
  
  export async function POST(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Create new user" }));
  }
  
  export async function PUT(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Update user" }));
  }
  
  export async function DELETE(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Delete user" }));
  }