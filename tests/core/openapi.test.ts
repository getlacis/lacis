import { buildOpenApiDoc } from "@/core/openapi"
import { defineHandler } from "@/core/defineHandler"
import { router, resetRouter } from "@/core/router"

beforeEach(() => resetRouter())

const info = { title: "Test API", version: "1.0.0" }

// Simulates an ArkType-like schema: implements Standard Schema + has toJsonSchema()
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

// Simulates a schema whose vendor has no converter installed
function unknownSchema() {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "unknown-lib",
      validate: (v: unknown) => ({ value: v }),
      types: undefined as any,
    },
  }
}

describe("buildOpenApiDoc", () => {
  describe("document structure", () => {
    it("returns a valid OpenAPI 3.1.0 skeleton", async () => {
      const doc = await buildOpenApiDoc({ info })
      expect(doc.openapi).toBe("3.1.0")
      expect(doc.info).toEqual(info)
      expect(doc.paths).toBeDefined()
    })

    it("returns empty paths when no routes are registered", async () => {
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths).toEqual({})
    })
  })

  describe("plain handlers", () => {
    it("generates a minimal operation for a plain handler", async () => {
      router.addRoute("GET", "/health", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/health"].get).toEqual({
        operationId: "getHealth",
        responses: { "200": { description: "Success" } },
      })
    })

    it("generates operations for all registered methods", async () => {
      router.addRoute("GET", "/users", () => {})
      router.addRoute("POST", "/users", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users"].get).toBeDefined()
      expect(doc.paths["/users"].post).toBeDefined()
    })
  })

  describe("path conversion", () => {
    it("converts :param segments to {param} notation", async () => {
      router.addRoute("GET", "/users/[id]", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users/{id}"]).toBeDefined()
    })

    it("converts optional :param? segments to {param} notation", async () => {
      router.addRoute("GET", "/users/[id?]", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users/{id}"]).toBeDefined()
    })

    it("handles multiple params in the same path", async () => {
      router.addRoute("GET", "/orgs/[org]/repos/[repo]", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/orgs/{org}/repos/{repo}"]).toBeDefined()
    })
  })

  describe("defineHandler meta", () => {
    it("includes summary, description, tags, and deprecated from meta", async () => {
      router.addRoute(
        "GET",
        "/users",
        defineHandler({
          meta: { summary: "List users", description: "Returns all users", tags: ["users"], deprecated: true },
          handler: async (_req, res) => res.json([]),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const op = doc.paths["/users"].get
      expect(op.summary).toBe("List users")
      expect(op.description).toBe("Returns all users")
      expect(op.tags).toEqual(["users"])
      expect(op.deprecated).toBe(true)
    })

    it("omits meta fields that are not set", async () => {
      router.addRoute("GET", "/users", defineHandler({ handler: async (_req, res) => res.json([]) }))
      const doc = await buildOpenApiDoc({ info })
      const op = doc.paths["/users"].get
      expect(op.summary).toBeUndefined()
      expect(op.tags).toBeUndefined()
    })
  })

  describe("schema conversion", () => {
    it("generates path parameters from params schema", async () => {
      router.addRoute(
        "GET",
        "/users/[id]",
        defineHandler({
          params: arktypeSchema({
            type: "object",
            properties: { id: { type: "string" } },
          }),
          handler: async (_req, res) => res.json({}),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const params = doc.paths["/users/{id}"].get.parameters
      expect(params).toContainEqual(
        expect.objectContaining({ name: "id", in: "path", required: true }),
      )
    })

    it("generates query parameters with required flag from schema", async () => {
      router.addRoute(
        "GET",
        "/users",
        defineHandler({
          query: arktypeSchema({
            type: "object",
            properties: { page: { type: "number" }, search: { type: "string" } },
            required: ["search"],
          }),
          handler: async (_req, res) => res.json([]),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const params = doc.paths["/users"].get.parameters
      const searchParam = params.find((p: any) => p.name === "search")
      const pageParam = params.find((p: any) => p.name === "page")
      expect(searchParam.required).toBe(true)
      expect(pageParam.required).toBe(false)
    })

    it("generates requestBody from body schema on POST", async () => {
      router.addRoute(
        "POST",
        "/users",
        defineHandler({
          body: arktypeSchema({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          }),
          handler: async (_req, res) => res.json({}),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const op = doc.paths["/users"].post
      expect(op.requestBody).toBeDefined()
      expect(op.requestBody.required).toBe(true)
      expect(op.requestBody.content["application/json"].schema).toBeDefined()
    })

    it("omits parameters gracefully when converter is not available", async () => {
      router.addRoute(
        "GET",
        "/users",
        defineHandler({
          params: unknownSchema() as any,
          handler: async (_req, res) => res.json([]),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const op = doc.paths["/users"].get
      expect(op.parameters).toBeUndefined()
      expect(op.responses).toBeDefined()
    })

    it("uses custom openapi path", async () => {
      router.addRoute("GET", "/users", () => {})
      const doc = await buildOpenApiDoc({ info, path: "/docs/openapi.json" })
      expect(doc.openapi).toBe("3.1.0")
    })
  })

  describe("operationId", () => {
    it("auto-generates operationId for plain handlers", async () => {
      router.addRoute("GET", "/users", () => {})
      router.addRoute("POST", "/users", () => {})
      router.addRoute("DELETE", "/users/[id]", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users"].get.operationId).toBe("getUsers")
      expect(doc.paths["/users"].post.operationId).toBe("postUsers")
      expect(doc.paths["/users/{id}"].delete.operationId).toBe("deleteUsersById")
    })

    it("auto-generates operationId for defineHandler routes", async () => {
      router.addRoute("GET", "/users/[id]", defineHandler({ handler: async (_req, res) => res.json({}) }))
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users/{id}"].get.operationId).toBe("getUsersById")
    })

    it("uses meta.operationId override when provided", async () => {
      router.addRoute(
        "GET",
        "/users/[id]",
        defineHandler({ meta: { operationId: "fetchUser" }, handler: async (_req, res) => res.json({}) }),
      )
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users/{id}"].get.operationId).toBe("fetchUser")
    })

    it("generates By<Param>And<Param> for multiple path params", async () => {
      router.addRoute("GET", "/orgs/[org]/repos/[repo]", () => {})
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/orgs/{org}/repos/{repo}"].get.operationId).toBe("getOrgsReposByOrgAndRepo")
    })
  })

  describe("responses", () => {
    it("generates response schemas for each status code", async () => {
      router.addRoute(
        "GET",
        "/users/[id]",
        defineHandler({
          responses: {
            200: arktypeSchema({ type: "object", properties: { id: { type: "string" } } }),
            404: arktypeSchema({ type: "object", properties: { error: { type: "string" } } }),
          },
          handler: async (_req, res) => res.json({}),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const responses = doc.paths["/users/{id}"].get.responses
      expect(responses["200"].description).toBe("OK")
      expect(responses["200"].content["application/json"].schema).toBeDefined()
      expect(responses["404"].description).toBe("Not Found")
      expect(responses["404"].content["application/json"].schema).toBeDefined()
    })

    it("falls back to description-only when schema conversion fails", async () => {
      router.addRoute(
        "GET",
        "/users",
        defineHandler({
          responses: { 200: unknownSchema() as any },
          handler: async (_req, res) => res.json([]),
        }),
      )
      const doc = await buildOpenApiDoc({ info })
      const responses = doc.paths["/users"].get.responses
      expect(responses["200"]).toEqual({ description: "OK" })
      expect(responses["200"].content).toBeUndefined()
    })

    it("keeps default 200 Success when responses is not set", async () => {
      router.addRoute("GET", "/users", defineHandler({ handler: async (_req, res) => res.json([]) }))
      const doc = await buildOpenApiDoc({ info })
      expect(doc.paths["/users"].get.responses).toEqual({ "200": { description: "Success" } })
    })
  })

  describe("servers", () => {
    it("includes servers when provided", async () => {
      const doc = await buildOpenApiDoc({
        info,
        servers: [
          { url: "https://api.example.com", description: "Production" },
          { url: "http://localhost:3000" },
        ],
      })
      expect(doc.servers).toEqual([
        { url: "https://api.example.com", description: "Production" },
        { url: "http://localhost:3000" },
      ])
    })

    it("omits servers when not provided", async () => {
      const doc = await buildOpenApiDoc({ info })
      expect(doc.servers).toBeUndefined()
    })
  })
})
