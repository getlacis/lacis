import type { Request, Response } from "@/index";

export async function GET(req: Request, res: Response) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Get all users" }));
  }
  
  export async function POST(req: Request, res: Response) {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Create new user" }));
  }
  
  export async function PUT(req: Request, res: Response) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Update user" }));
  }
  
  export async function DELETE(req: Request, res: Response) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Delete user" }));
  }