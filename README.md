# Zeno

**Zeno** is a zero-dependency, lightweight web framework for TypeScript, designed for maximum simplicity and flexibility. It provides intuitive file-based routing and makes building APIs and web applications straightforward while ensuring high performance.

> **Note**  
> This project is intended for educational purposes only. It is not production-ready and should not be used in production environments. Use at your own risk, and ensure thorough testing before considering it for production use.

## Features

- **No External Dependencies**: Built entirely with TypeScript and Node.js standard libraries.
  
- **File-Based Routing**: Routes are automatically generated from your folder structure in the `routes/` directory, simplifying route management and code maintenance.
  
- **Dynamic Routes**: Easily create dynamic routes using template parameters directly in file and folder names, e.g., `api/[model].ts`.

- **HTTP Method Handlers**: Define specific handlers for different HTTP methods (GET, POST, PUT, DELETE, PATCH) in the same file.

- **Performance Optimized**: Designed to be ultra-fast with efficient route handling and a minimal memory footprint.

- **Hot Reloading**: Automatically refresh the application when code changes, providing a smooth development experience without manual server restarts.

- **Middleware Support**: Add route-specific middleware using `+middleware.ts` files that can run before and after requests.

- **Server-Sent Events (SSE)**: Built-in support for real-time updates using SSE.

- **Multi-Platform**: Runs on Node.js, Vercel, or Netlify with the same codebase.

## Installation

### Prerequisites

Zeno requires **Node.js** and **npm** or **yarn** to function. Make sure you have these tools installed before getting started.

## Project Structure Example

Here's an example folder structure for a Zeno project:

```
/project-root
  /routes
    +middleware.ts       # Global middleware
    hello.ts             # Simple route
    /api
      +middleware.ts     # API-specific middleware
      methods.ts         # Route with different HTTP methods
      [model].ts         # Dynamic route
      /models
        [model].ts       # Nested dynamic route
```

### Example: Dynamic Route

**routes/api/[model].ts**:

```typescript
import { Response, Request } from "zeno";

export default async function handler(req: Request, res: Response) {
  const { model } = (req as any).params;  // 'model' corresponds to the [model] in the filename
  
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: `Model: ${model}` }));
}
```

### Example: HTTP Method Handlers

**routes/api/methods.ts**:

```typescript
import { Response, Request } from "zeno";

export async function GET(req: Request, res: Response) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Get all users" }));
}

export async function POST(req: Request, res: Response) {
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Create new user" }));
}
```

### Example: Simple Route with Enhanced Response

**routes/hello.ts**:

```typescript
import type { Request, Response } from "zeno";

export const GET = async (req: Request, res: Response) => {
  res.send("Hello World!");
};
```

## Starting the Server

To start a server with Zeno, use the `createServer` function:

```typescript
import { createServer, getRoutesDir } from "zeno";

const routesDir = getRoutesDir();
createServer(routesDir);
```

## NPM Commands

### Development Mode

```bash
npm run dev
```

Starts a local server in development mode with automatic file reloading.

### Build for Production

```bash
npm run build
```

Compiles your code to JavaScript and prepares your project for production.

### Production Mode

```bash
npm run start
```

Starts the server in production mode without automatic reloading.

## Middleware

Middleware functions let you execute code before and after handling a request. Create a `+middleware.ts` file:

```typescript
import type { Request, Response } from "zeno";

export const beforeRequest = async (req: Request, res: Response) => {
  console.log(`Request: ${req.method} ${req.url}`);
  res.setHeader('X-Custom-Header', 'true');
  return true; // Continue processing
};

export const afterRequest = async (req: Request, res: Response) => {
  console.log(`Response sent with status: ${res.statusCode}`);
};
```

## Server-Sent Events (SSE)

Zeno includes built-in support for SSE:

```typescript
import type { Request, Response } from "zeno";

export async function GET(req: Request, res: Response) {
  res.initSSE();
  
  res.sseSend({ status: "connected" });
  res.sseEvent("userUpdate", { id: 1, name: "John" });
  
  // Close the connection after sending events
  res.sseClose();
}
```

## License

Zeno is under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

## Architecture Explanation

- **Dynamic Routes**: Files in the `routes/` directory are treated as routes. If a file uses the `[param]` syntax in its name (like `api/[model].ts`), it's processed as a dynamic route where `model` becomes a request parameter. For example, a request to `/api/user` will match the file `api/[model].ts`, and you can retrieve the value of `model` as `req.params.model`.

- **Static Routes**: Files like `api/methods.ts` are processed as static routes and are directly accessible at the URL `/api/methods`.

### Advantages of Zeno
- **Simplicity**: Easy to set up and use with an intuitive file structure.
- **Flexibility**: Allows you to create APIs and web applications in a modular way.
- **Performance**: Designed to operate with low latency and optimized route handling.
- **Zero Dependencies**: Built entirely on Node.js standard libraries with no external packages required.

---

✨ **Fun fact**: The project name comes from the philosopher Zeno and the Dragon Ball character Zeno. Useless information, do with it what you will!
