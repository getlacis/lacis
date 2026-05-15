import { router, resetRouter, registerRoutes } from "@/core/router"

const noop = () => {}

beforeEach(() => resetRouter())

describe("Router.getRoutes()", () => {
  it("returns empty array when no routes are registered", () => {
    expect(router.getRoutes()).toEqual([])
  })

  it("returns a static route", () => {
    router.addRoute("GET", "/users", noop)
    expect(router.getRoutes()).toEqual([{ method: "GET", path: "/users", handler: noop }])
  })

  it("returns the root path as /", () => {
    router.addRoute("GET", "/", noop)
    expect(router.getRoutes()).toContainEqual({ method: "GET", path: "/", handler: noop })
  })

  it("converts [param] segments to :param notation", () => {
    router.addRoute("GET", "/users/[id]", noop)
    expect(router.getRoutes()).toContainEqual({ method: "GET", path: "/users/:id", handler: noop })
  })

  it("converts optional [param?] segments to :param? notation", () => {
    router.addRoute("GET", "/users/[id?]", noop)
    expect(router.getRoutes()).toContainEqual({ method: "GET", path: "/users/:id?", handler: noop })
  })

  it("returns wildcard routes", () => {
    router.addRoute("GET", "/static/*", noop)
    expect(router.getRoutes()).toContainEqual({ method: "GET", path: "/static/*", handler: noop })
  })

  it("returns all methods registered on the same path", () => {
    const getH = () => {}
    const postH = () => {}
    router.addRoute("GET", "/users", getH)
    router.addRoute("POST", "/users", postH)
    const routes = router.getRoutes()
    expect(routes).toContainEqual({ method: "GET", path: "/users", handler: getH })
    expect(routes).toContainEqual({ method: "POST", path: "/users", handler: postH })
  })

  it("handles deeply nested routes with multiple params", () => {
    router.addRoute("GET", "/orgs/[org]/repos/[repo]", noop)
    expect(router.getRoutes()).toContainEqual({
      method: "GET",
      path: "/orgs/:org/repos/:repo",
      handler: noop,
    })
  })

  it("does not include empty-string method entries", () => {
    router.addRoute("", "/users", noop)
    const routes = router.getRoutes()
    expect(routes.every((r) => r.method !== "")).toBe(true)
  })

  it("includes routes added via registerRoutes", () => {
    const h = () => {}
    registerRoutes([{ path: "/items/:id", handlers: { GET: h as any } }])
    const routes = router.getRoutes()
    expect(routes).toContainEqual({ method: "GET", path: "/items/:id", handler: h })
  })
})
