import type { NetlifyEvent, Request, Response } from "@/types";

const mockRegisterRoutes = jest.fn();
const mockFindRoute = jest.fn();
const mockIsRouteError = jest.fn((obj: any) => "error" in obj);
const mockRunMiddlewares = jest.fn().mockResolvedValue(true);
const mockRegisterMiddlewareConfig = jest.fn();
const mockHasMiddlewares = jest.fn().mockReturnValue(true);

jest.mock("@/core/router", () => ({
  registerRoutes: (...args: any[]) => mockRegisterRoutes(...args),
  findRoute: (...args: any[]) => mockFindRoute(...args),
  isRouteError: (obj: any) => mockIsRouteError(obj),
}));

jest.mock("@/core/middleware", () => ({
  runMiddlewares: (...args: any[]) => mockRunMiddlewares(...args),
  registerMiddlewareConfig: (...args: any[]) => mockRegisterMiddlewareConfig(...args),
  hasMiddlewares: () => mockHasMiddlewares(),
}));

import { netlifyAdapter } from "@/adapters/netlify";

function event(overrides: Partial<NetlifyEvent> = {}): NetlifyEvent {
  return {
    rawUrl: "http://localhost/users",
    rawQuery: "",
    path: "/users",
    httpMethod: "GET",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

function makeRoute(
  handler: (req: Request, res: Response) => Promise<void> = async (
    _req,
    res,
  ) => {
    res.status(200).json({ ok: true });
  },
) {
  return { handler, params: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsRouteError.mockImplementation((obj: any) => "error" in obj);
  mockRunMiddlewares.mockResolvedValue(true);
  mockHasMiddlewares.mockReturnValue(true);
});

describe("netlifyAdapter.createHandler()", () => {
  it("throws when passed a string instead of ServerlessConfig", () => {
    expect(() => netlifyAdapter.createHandler("routes")).toThrow(
      "ServerlessConfig",
    );
  });
});

describe("netlifyAdapter handler", () => {
  it("registers routes exactly once across multiple calls (lazy init)", async () => {
    const routes = [{ path: "/users", handlers: { GET: async () => {} } }];
    const handler = netlifyAdapter.createHandler({ routes }) as Function;
    mockFindRoute.mockReturnValue(makeRoute());

    await handler(event(), {});
    await handler(event(), {});
    await handler(event(), {});

    expect(mockRegisterRoutes).toHaveBeenCalledTimes(1);
    expect(mockRegisterRoutes).toHaveBeenCalledWith(routes);
  });

  it("returns 404 when route is not found", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(null);

    const result = await handler(event({ path: "/not-found" }), {});

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: "Route not found" });
  });

  it("returns 405 when method is not allowed", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({ error: "Method Not Allowed", status: 405 });
    mockIsRouteError.mockReturnValue(true);

    const result = await handler(event({ httpMethod: "DELETE" }), {});

    expect(result.statusCode).toBe(405);
    expect(JSON.parse(result.body)).toEqual({ error: "Method Not Allowed" });
  });

  it("calls the route handler and returns its response", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req, res) => {
        res.status(201).json({ id: 42 });
      }),
    );

    const result = await handler(event({ httpMethod: "POST" }), {});

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ id: 42 });
  });

  it("forwards route params to the request", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    let capturedParams: Record<string, string> | undefined;

    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        capturedParams = req.params;
        res.status(200).json({});
      },
      params: { id: "99" },
    });

    await handler(event({ path: "/users/99" }), {});

    expect(capturedParams).toEqual({ id: "99" });
  });

  it("appends query string to req.url", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    let capturedUrl: string | undefined;

    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        capturedUrl = req.url;
        res.status(200).json({});
      },
      params: {},
    });

    await handler(
      event({
        path: "/users",
        queryStringParameters: { page: "2", limit: "10" },
      }),
      {},
    );

    expect(capturedUrl).toMatch(/\/users\?/);
    expect(capturedUrl).toContain("page=2");
    expect(capturedUrl).toContain("limit=10");
  });

  it("makes the body readable via req.body()", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    let capturedBody: Buffer | undefined;

    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        capturedBody = await req.body();
        res.status(200).json({});
      },
      params: {},
    });

    await handler(
      event({
        httpMethod: "POST",
        body: JSON.stringify({ name: "lacis" }),
        headers: { "content-type": "application/json" },
      }),
      {},
    );

    expect(capturedBody?.toString()).toBe('{"name":"lacis"}');
  });

  it("makes the body parseable via req.json()", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    let parsed: unknown;

    mockFindRoute.mockReturnValue({
      handler: async (req: Request, res: Response) => {
        parsed = await req.json();
        res.status(200).json({});
      },
      params: {},
    });

    await handler(
      event({
        httpMethod: "POST",
        body: JSON.stringify({ hello: "world" }),
        headers: { "content-type": "application/json" },
      }),
      {},
    );

    expect(parsed).toEqual({ hello: "world" });
  });

  it("runs beforeRequest middleware and stops if it returns false", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    const routeHandler = jest.fn();
    mockFindRoute.mockReturnValue({ handler: routeHandler, params: {} });
    mockRunMiddlewares.mockImplementation(async (type: string) =>
      type === "beforeRequest" ? false : true,
    );

    await handler(event(), {});

    expect(routeHandler).not.toHaveBeenCalled();
  });

  it("registers config middleware via registerMiddlewareConfig", async () => {
    const beforeFn = jest.fn();
    const routes = [{ path: "/users", handlers: {} }];
    const handler = netlifyAdapter.createHandler({
      routes,
      middleware: { beforeRequest: beforeFn },
    }) as Function;
    mockFindRoute.mockReturnValue(makeRoute());

    await handler(event(), {});

    expect(mockRegisterMiddlewareConfig).toHaveBeenCalledWith({ beforeRequest: beforeFn });
  });

  it("returns 500 when the route handler throws", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({
      handler: async () => {
        throw new Error("boom");
      },
      params: {},
    });

    const result = await handler(event(), {});

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ error: "Internal server error" });
  });

  it("respects status set via res.status()", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req, res) => {
        res.status(201).json({ created: true });
      }),
    );

    const result = await handler(event({ httpMethod: "POST" }), {});

    expect(result.statusCode).toBe(201);
  });

  it("respects status set via writeHead", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req, res) => {
        res.writeHead(201, { "content-type": "text/plain" });
        res.end("created");
      }),
    );

    const result = await handler(event({ httpMethod: "POST" }), {});

    expect(result.statusCode).toBe(201);
  });

  it("includes response headers in the result", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue(
      makeRoute(async (_req, res) => {
        res.setHeader("x-custom", "value");
        res.status(200).json({ ok: true });
      }),
    );

    const result = await handler(event(), {});

    expect(result.headers?.["x-custom"]).toBe("value");
  });

  it("calls afterRequest middleware after the route handler", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    const order: string[] = [];

    mockFindRoute.mockReturnValue({
      handler: async (_req: Request, res: Response) => {
        order.push("handler");
        res.status(200).json({ ok: true });
      },
      params: {},
    });
    mockRunMiddlewares.mockImplementation(async (type: string) => {
      order.push(type);
      return true;
    });

    await handler(event(), {});

    expect(order.indexOf("beforeRequest")).toBeLessThan(order.indexOf("handler"));
    expect(order.indexOf("handler")).toBeLessThan(order.indexOf("afterRequest"));
  });

  it("calls onError middleware when route handler throws", async () => {
    const handler = netlifyAdapter.createHandler({ routes: [] }) as Function;
    mockFindRoute.mockReturnValue({
      handler: async () => { throw new Error("fail"); },
      params: {},
    });

    const result = await handler(event(), {});

    expect(result.statusCode).toBe(500);
    expect(mockRunMiddlewares).toHaveBeenCalledWith(
      "onError",
      expect.anything(),
      expect.anything(),
      { error: expect.any(Error) }
    );
  });
});
