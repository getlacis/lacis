# Zeno

**Zeno** is a zero-dependency, lightweight web framework for TypeScript, designed for maximum simplicity and flexibility. It provides intuitive file-based routing and makes building APIs and web applications straightforward while ensuring high performance.

## Features

- **File-Based Routing**: Routes are automatically generated from your folder structure in the `routes/` directory, simplifying route management and code maintenance.
  
- **Dynamic Routes**: Easily create dynamic routes using bracket parameters in file and folder names, e.g., `api/[model]/index.ts`.

- **HTTP Method Handlers**: Define specific handlers for different HTTP methods (GET, POST, PUT, DELETE, PATCH) in the same file or use a default export.

- **Multi-Platform Support**: Run on different platforms with the same codebase with built-in adapters for Node.js, Vercel, Netlify, and Bun.

- **Middleware System**: Add global, path-specific, or route-specific middleware using `+middleware.ts` files.

- **Server-Sent Events (SSE)**: Built-in support for real-time updates with both server and client SSE implementations.

- **Hot Reloading**: Automatically reload routes when files change during development.

## Installation

```bash
npm install we don't have package for now ahah ^^
```

## Getting Started

### Project Structure

Here's an example folder structure for a Zeno project:

```
/project-root
  /routes
    +middleware.ts       # Global middleware
    /hello
      index.ts           # Simple route
    /api
      +middleware.ts     # API-specific middleware
      /methods
        index.ts         # Route with different HTTP methods
      /[models]
        index.ts         # Dynamic route
      /models
        /[model]
          index.ts       # Nested dynamic route
      /updates
        index.ts         # SSE example
      /sseclient
        index.ts         # SSE client example
```

### Creating a Simple Server

```typescript
import { createServer, getRoutesDir } from "zeno";

const routesDir = getRoutesDir(); // or specify your custom route directory
createServer(routesDir, { 
  isDev: process.env.NODE_ENV === 'development',
  port: 3000,
  platform: 'node' // 'node', 'vercel', 'netlify', or 'bun'
});
```

### Basic Route Handler

**routes/hello/index.ts**:

```typescript
import type { Request, Response } from "zeno";

export const GET = async (req: Request, res: Response) => {
  res.send("Hello World!");
};
```

### Route with Multiple HTTP Methods

**routes/api/methods/index.ts**:

```typescript
import type { Request, Response } from "zeno";

export async function GET(req: Request, res: Response) {
  res.status(200).json({ message: "Get all users" });
}

export async function POST(req: Request, res: Response) {
  res.status(201).json({ message: "Create new user" });
}

export async function PUT(req: Request, res: Response) {
  res.status(200).json({ message: "Update user" });
}

export async function DELETE(req: Request, res: Response) {
  res.status(200).json({ message: "Delete user" });
}
```

### Dynamic Route

**routes/api/[models]/index.ts**:

```typescript
import type { Request, Response } from "zeno";

export default async function handler(req: Request, res: Response) {
  const { models } = req.params || {};
  res.status(200).json({ message: `Model: ${models}` });
}
```

### Using Enhanced Request/Response

Zeno enhances the standard Node.js request and response objects with additional methods:

```typescript
import type { Request, Response } from "zeno";

export const GET = async (req: Request, res: Response) => {
  // Enhanced methods available
  res.status(200).json({ success: true, data: "Hello!" });
};
```

## Middleware

Middleware allows you to execute code before and after request handling. Create a `+middleware.ts` file in any directory:

```typescript
import type { Request, Response } from "zeno";

export const beforeRequest = async (req: Request, res: Response) => {
  console.log(`[API] Request: ${req.method} ${req.url}`);
  res.setHeader('X-API-Middleware', 'true');
  return true; // Continue processing request
};

export const afterRequest = async (req: Request, res: Response) => {
  console.log(`[API] Response sent with status: ${res.statusCode}`);
};

// Optional error handler
export const onError = async (req: Request, res: Response, context: any) => {
  console.error(`Error occurred:`, context.error);
};
```

## Server-Sent Events (SSE)

Zeno provides built-in support for Server-Sent Events:

### Server Side

```typescript
import type { Request, Response } from "zeno";

export async function GET(req: Request, res: Response) {
  res.initSSE();
  
  console.log("Sending regular updates");
  res.sseSend({ status: "connected" });
  
  res.sseEvent("userUpdate", { id: 1, name: "John" });
  res.sseClose();
}
```

### Client Side

```typescript
import { createSSEClient } from "zeno";
import type { Request, Response } from "zeno";

export async function GET(req: Request, res: Response) {
  const client = createSSEClient("http://localhost:3000/api/updates");
  res.initSSE();

  const sseClient = await client;
  await sseClient
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
```

## Configuration Options

Zeno's `createServer` function accepts a configuration object with the following options:

```typescript
createServer(routesDir, {
  // Basic settings
  isDev: true,                 // Enable development mode features
  port: 3000,                  // Server port
  platform: 'node',            // 'node', 'vercel', 'netlify', or 'bun'
  timeout: 30000,              // Request timeout in ms
  
  // HTTPS Support
  httpsOptions: {
    cert: fs.readFileSync('path/to/cert.pem'),
    key: fs.readFileSync('path/to/key.pem')
  },
  
  // Default headers for all responses
  defaultHeaders: {
    'Access-Control-Allow-Origin': '*',
    'X-Powered-By': 'Zeno'
  },
  
  // Clustering configuration
  cluster: {
    enabled: true,
    workers: 4,                // Number of workers (defaults to CPU count)
    loadBalancing: 'least-connections' // 'round-robin', 'least-connections', 'least-cpu', 'fastest-response'
  },
  
  // Performance monitoring
  monitoring: {
    enabled: true,
    sampleInterval: 5000,      // How often to sample metrics (ms)
    reportInterval: 60000,     // How often to log metrics (ms)
    thresholds: {
      cpu: 80,                 // Alert on CPU usage above 80%
      memory: 80,              // Alert on memory usage above 80%
      responseTime: 1000,      // Alert on avg response time above 1000ms
      errorRate: 5             // Alert on error rate above 5%
    }
  }
});
```

## Platform Specific Code

Zeno supports different platforms through platform-specific adapters:

```typescript
import { createServer, getRoutesDir } from "zeno";

// For Node.js
createServer(getRoutesDir(), { platform: 'node' });

// For Vercel
export default createServer(getRoutesDir(), { platform: 'vercel' });

// For Netlify
export const handler = createServer(getRoutesDir(), { platform: 'netlify' });

// For Bun
createServer(getRoutesDir(), { platform: 'bun' });
```

## Advanced Features

### Graceful Shutdown

Zeno provides graceful shutdown capabilities that ensure active connections can complete before the server stops:

```typescript
import { createServer, getRoutesDir } from "zeno";
import { setupGracefulShutdown } from "zeno";

const server = createServer(getRoutesDir());

// Additional shutdown options
setupGracefulShutdown(server, {
  timeout: 30000,
  signals: ['SIGTERM', 'SIGINT'],
  beforeShutdown: async () => {
    console.log('Performing pre-shutdown tasks...');
  },
  onShutdown: async () => {
    console.log('Performing post-shutdown cleanup...');
  }
});
```

### Performance Monitoring

Access performance metrics through the `/health` endpoint when monitoring is enabled:

```typescript
createServer(getRoutesDir(), {
  monitoring: {
    enabled: true,
    // Additional options...
  }
});
```

This will provide detailed stats on:
- Request counts and rates
- Response times (avg, min, max, p50, p90, p99)
- Memory and CPU usage
- Error rates
- Status code distribution

## License

Zeno is under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

✨ **Fun fact**: The project name comes from the philosopher Zenon and the Dragon Ball character Zeno. Useless information, do with it what you will!
