import { createResponseCache, withCache, defaultCacheKey } from "@/core/responseCache"
import { defineHandler } from "@/core/defineHandler"
import type { Request, Response } from "@/types"

function makeReq(method = "GET", url = "/api/data"): Request {
  return { method, url, headers: {} } as unknown as Request
}

function makeRes() {
  const headers: Record<string, string> = {}
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn((name: string, value: string) => { headers[name.toLowerCase()] = value }),
    end: jest.fn(function(this: any) { this.headersSent = true }),
    getHeader: (name: string) => headers[name.toLowerCase()],
    _headers: headers,
  }
  return res as unknown as Response
}

describe("defaultCacheKey", () => {
  it("combines method and url", () => {
    expect(defaultCacheKey(makeReq("GET", "/foo?bar=1"))).toBe("GET:/foo?bar=1")
  })
})

describe("createResponseCache", () => {
  it("returns undefined (pass-through) on first request", () => {
    const mw = createResponseCache({ ttl: 60 })
    const result = mw(makeReq(), makeRes())
    expect(result).toBeUndefined()
  })

  it("serves from cache on second identical request", () => {
    const mw = createResponseCache({ ttl: 60 })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    res1.setHeader("Content-Type", "application/json")
    ;(res1 as any).statusCode = 200
    res1.end('{"ok":true}')

    const res2 = makeRes()
    const result = mw(makeReq(), res2)
    expect(result).toBe(false)
    expect(res2.end).toHaveBeenCalledWith('{"ok":true}')
  })

  it("does not cache non-2xx responses", () => {
    const mw = createResponseCache({ ttl: 60 })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    ;(res1 as any).statusCode = 500
    res1.end("oops")

    const res2 = makeRes()
    const result = mw(makeReq(), res2)
    expect(result).toBeUndefined()
  })

  it("does not cache responses with Set-Cookie", () => {
    const mw = createResponseCache({ ttl: 60 })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    res1.setHeader("Set-Cookie", "session=abc")
    ;(res1 as any).statusCode = 200
    res1.end("data")

    const res2 = makeRes()
    const result = mw(makeReq(), res2)
    expect(result).toBeUndefined()
  })

  it("does not cache SSE responses", () => {
    const mw = createResponseCache({ ttl: 60 })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    res1.setHeader("Content-Type", "text/event-stream")
    res1.end(undefined)

    const res2 = makeRes()
    expect(mw(makeReq(), res2)).toBeUndefined()
  })

  it("skips non-matching methods", () => {
    const mw = createResponseCache({ ttl: 60, methods: ["GET"] })
    const req = makeReq("POST")
    const res = makeRes()
    expect(mw(req, res)).toBeUndefined()
    res.end("body")

    expect(mw(makeReq("POST"), makeRes())).toBeUndefined()
  })

  it("excludes paths in the exclude list", () => {
    const mw = createResponseCache({ ttl: 60, exclude: "/api/auth" })
    const req = makeReq("GET", "/api/auth/login")
    const res = makeRes()
    mw(req, res)
    res.end("secret")

    expect(mw(makeReq("GET", "/api/auth/login"), makeRes())).toBeUndefined()
  })

  it("respects match predicate", () => {
    const mw = createResponseCache({ ttl: 60, match: (req) => req.url === "/cacheable" })
    const req = makeReq("GET", "/not-cacheable")
    const res = makeRes()
    mw(req, res)
    res.end("data")

    expect(mw(makeReq("GET", "/not-cacheable"), makeRes())).toBeUndefined()
  })

  it("differentiates cache keys by query string by default", () => {
    const mw = createResponseCache({ ttl: 60 })

    const res1 = makeRes()
    mw(makeReq("GET", "/search?q=foo"), res1)
    res1.end("foo result")

    const res2 = makeRes()
    mw(makeReq("GET", "/search?q=bar"), res2)
    res2.end("bar result")

    const res3 = makeRes()
    expect(mw(makeReq("GET", "/search?q=foo"), res3)).toBe(false)
    expect(res3.end).toHaveBeenCalledWith("foo result")
  })

  it("expires entries after ttl", () => {
    jest.useFakeTimers()
    const mw = createResponseCache({ ttl: 10 })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    res1.end("fresh")

    jest.advanceTimersByTime(11_000)

    const res2 = makeRes()
    expect(mw(makeReq(), res2)).toBeUndefined()
    jest.useRealTimers()
  })

  it("uses a custom shouldCache predicate", () => {
    const mw = createResponseCache({
      ttl: 60,
      shouldCache: (_req, res) => res.statusCode === 200,
    })
    const req = makeReq()

    const res1 = makeRes()
    mw(req, res1)
    ;(res1 as any).statusCode = 201
    res1.end("created")

    expect(mw(makeReq(), makeRes())).toBeUndefined()
  })
})

describe("withCache", () => {
  it("passes through on first call", async () => {
    let called = false
    const handler = withCache({ ttl: 60 }, (_req, res) => {
      called = true
      res.end("hello")
    })
    await handler(makeReq(), makeRes())
    expect(called).toBe(true)
  })

  it("serves from cache on second call", async () => {
    const handler = withCache({ ttl: 60 }, (_req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end('{"v":1}')
    })

    await handler(makeReq(), makeRes())

    const res2 = makeRes()
    await handler(makeReq(), res2)
    expect(res2.end).toHaveBeenCalledWith('{"v":1}')
  })

  it("uses custom key function", async () => {
    const handler = withCache(
      { ttl: 60, key: () => "fixed-key" },
      (_req, res) => { res.end("data") },
    )
    await handler(makeReq("GET", "/a"), makeRes())

    const res2 = makeRes()
    await handler(makeReq("GET", "/b"), res2)
    expect(res2.end).toHaveBeenCalledWith("data")
  })
})

describe("defineHandler cache option", () => {
  it("caches the response on second call", async () => {
    let calls = 0
    const h = defineHandler({
      cache: { ttl: 60 },
      handler: (_req, res) => {
        calls++
        res.end("result")
      },
    })

    const res1 = makeRes()
    await h(makeReq() as any, res1 as any)

    const res2 = makeRes()
    await h(makeReq() as any, res2 as any)

    expect(calls).toBe(1)
    expect(res2.end).toHaveBeenCalledWith("result")
  })

  it("does not cache when handler is not called with cache option", async () => {
    let calls = 0
    const h = defineHandler({
      handler: (_req, res) => {
        calls++
        res.end("result")
      },
    })

    await h(makeReq() as any, makeRes() as any)
    await h(makeReq() as any, makeRes() as any)

    expect(calls).toBe(2)
  })
})
