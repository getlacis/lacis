import http from "http"
import { IncomingMessage } from "http"
import supertest from "supertest"
import { buildOpenApiDoc } from "@/core/openapi"
import { defineHandler } from "@/core/defineHandler"
import { findRoute, registerRoutes, resetRouter, router } from "@/core/router"
import { resetMiddlewares } from "@/core/middleware"
import { nodeBody, withRequestMethods, withResponseMethods } from "@/utils/adapter-base"
import type { ServerlessRoute } from "@/types"

class _ReqBase extends IncomingMessage {
  params: Record<string, string> = {}
  body = nodeBody
}
class TestRequest extends withRequestMethods(_ReqBase) {}
class TestResponse extends withResponseMethods(http.ServerResponse<TestRequest>) {}

async function createApp(routes: ServerlessRoute[], openapiPath = "/openapi.json") {
  resetRouter()
  resetMiddlewares()
  registerRoutes(routes)

  const doc = await buildOpenApiDoc({ path: openapiPath, info: { title: "Test API", version: "0.1.0" } })
  router.addRoute("GET", openapiPath, (_req: any, res: any) => res.json(doc))

  const server = http.createServer<typeof TestRequest, typeof TestResponse>(
    { IncomingMessage: TestRequest, ServerResponse: TestResponse },
    async (req, res) => {
      try {
        const rawUrl = req.url ?? "/"
        const pathname = rawUrl.includes("?") ? rawUrl.slice(0, rawUrl.indexOf("?")) : rawUrl
        const route = findRoute(pathname, req.method ?? "GET")
        if (!route) { res.status(404).json({ error: "Not found" }); return }
        if ("error" in route) { res.status((route as any).status ?? 500).json({ error: (route as any).error }); return }
        req.params = route.params
        await route.handler(req as any, res as any)
        if (!res.headersSent) res.end()
      } catch {
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" })
      }
    },
  )

  return supertest(server)
}

function arktypeSchema(jsonSchema: Record<string, any>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "arktype",
      validate: (v: unknown) => ({ value: v }),
      types: undefined as any,
    },
    toJsonSchema: () => jsonSchema,
  }
}

describe("OpenAPI endpoint integration", () => {
  it("serves the OpenAPI doc at /openapi.json", async () => {
    const app = await createApp([])
    const { body } = await app.get("/openapi.json").expect(200)
    expect(body.openapi).toBe("3.1.0")
    expect(body.info.title).toBe("Test API")
    expect(body.paths).toBeDefined()
  })

  it("serves at a custom path when configured", async () => {
    const app = await createApp([], "/docs/api.json")
    await app.get("/docs/api.json").expect(200)
    await app.get("/openapi.json").expect(404)
  })

  it("includes registered plain routes in the doc", async () => {
    const app = await createApp([
      { path: "/users", handlers: { GET: async (_req: any, res: any) => res.json([]) } },
    ])
    const { body } = await app.get("/openapi.json").expect(200)
    expect(body.paths["/users"]).toBeDefined()
    expect(body.paths["/users"].get).toBeDefined()
  })

  it("includes defineHandler meta in the doc", async () => {
    const app = await createApp([
      {
        path: "/users",
        handlers: {
          GET: defineHandler({
            meta: { summary: "List users", tags: ["users"] },
            handler: async (_req, res) => res.json([]),
          }) as any,
        },
      },
    ])
    const { body } = await app.get("/openapi.json").expect(200)
    expect(body.paths["/users"].get.summary).toBe("List users")
    expect(body.paths["/users"].get.tags).toEqual(["users"])
  })

  it("includes path params from defineHandler schema", async () => {
    const app = await createApp([
      {
        path: "/users/:id",
        handlers: {
          GET: defineHandler({
            params: arktypeSchema({
              type: "object",
              properties: { id: { type: "string" } },
            }) as any,
            handler: async (_req, res) => res.json({}),
          }) as any,
        },
      },
    ])
    const { body } = await app.get("/openapi.json").expect(200)
    expect(body.paths["/users/{id}"]).toBeDefined()
    const params = body.paths["/users/{id}"].get.parameters
    expect(params).toContainEqual(expect.objectContaining({ name: "id", in: "path" }))
  })

  it("the openapi route itself does not appear in the doc paths", async () => {
    const app = await createApp([])
    const { body } = await app.get("/openapi.json").expect(200)
    // The doc is built before the openapi route is added to the router
    expect(body.paths["/openapi.json"]).toBeUndefined()
  })
})
