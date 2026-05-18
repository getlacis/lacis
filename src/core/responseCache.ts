import type { MiddlewareCallback, Request, Response } from "@/types"

const CACHE_MAX_DEFAULT = 500
const CACHE_EVICT_BATCH = 50

interface CacheEntry {
  body: any
  status: number
  contentType: string
  expiresAt: number
}

function createStore(maxSize: number) {
  const map = new Map<string, CacheEntry>()

  function get(key: string): CacheEntry | undefined {
    const entry = map.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      map.delete(key)
      return undefined
    }
    // LRU: promote to end so eviction always removes the least recently used
    map.delete(key)
    map.set(key, entry)
    return entry
  }

  function set(key: string, entry: CacheEntry): void {
    if (map.size >= maxSize) {
      let evicted = 0
      for (const k of map.keys()) {
        map.delete(k)
        if (++evicted >= CACHE_EVICT_BATCH) break
      }
    }
    map.set(key, entry)
  }

  return { get, set }
}

type Store = ReturnType<typeof createStore>

function interceptResponse(
  res: Response,
  onCapture: (entry: Omit<CacheEntry, "expiresAt">) => void,
): void {
  let contentType = ""
  let hasCookie = false
  let captured = false

  const origSetHeader = (res as any).setHeader.bind(res)
  ;(res as any).setHeader = (name: string, value: any) => {
    const lo = name.toLowerCase()
    if (lo === "content-type") contentType = String(value)
    if (lo === "set-cookie") hasCookie = true
    return origSetHeader(name, value)
  }

  if (typeof (res as any).writeHead === "function") {
    const origWriteHead = (res as any).writeHead.bind(res)
    ;(res as any).writeHead = (code: number, headers?: Record<string, any>) => {
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          const lo = k.toLowerCase()
          if (lo === "content-type") contentType = String(v)
          if (lo === "set-cookie") hasCookie = true
        }
      }
      return origWriteHead(code, headers)
    }
  }

  // Guard against double-end (e.g. error handler calling end after handler already did)
  const origEnd = (res as any).end.bind(res)
  ;(res as any).end = (data?: any) => {
    if (!captured) {
      captured = true
      if (!hasCookie && !contentType.includes("text/event-stream")) {
        onCapture({ body: data, status: res.statusCode, contentType })
      }
    }
    return origEnd(data)
  }
}

function replayEntry(res: Response, entry: CacheEntry): void {
  if (entry.contentType) res.setHeader("Content-Type", entry.contentType)
  ;(res as any).statusCode = entry.status
  res.end(entry.body)
}

export function defaultCacheKey(req: Request): string {
  return (req.method ?? "GET") + ":" + (req.url ?? "/")
}

export interface ResponseCacheOptions {
  ttl: number
  methods?: string[]
  maxSize?: number
  keyGenerator?: (req: Request) => string
  match?: (req: Request) => boolean
  exclude?: string | string[]
  shouldCache?: (req: Request, res: Response) => boolean
}

export function createResponseCache(options: ResponseCacheOptions): MiddlewareCallback {
  const {
    ttl,
    methods = ["GET", "HEAD"],
    maxSize = CACHE_MAX_DEFAULT,
    keyGenerator = defaultCacheKey,
    match,
    exclude,
    shouldCache = (_req, res) => res.statusCode >= 200 && res.statusCode < 300,
  } = options

  const methodSet = new Set(methods.map((m) => m.toUpperCase()))
  const excludeList = exclude ? (Array.isArray(exclude) ? exclude : [exclude]) : []
  const store = createStore(maxSize)

  return (req, res) => {
    if (!methodSet.has((req.method ?? "GET").toUpperCase())) return

    const url = req.url ?? "/"
    const pathname = url.indexOf("?") === -1 ? url : url.slice(0, url.indexOf("?"))

    if (excludeList.some((prefix) => pathname.startsWith(prefix))) return
    if (match && !match(req)) return

    const key = keyGenerator(req)
    const cached = store.get(key)

    if (cached) {
      replayEntry(res, cached)
      return false
    }

    interceptResponse(res, (partial) => {
      if (shouldCache(req, res)) {
        store.set(key, { ...partial, expiresAt: Date.now() + ttl * 1000 })
      }
    })
  }
}

export interface WithCacheOptions {
  ttl: number
  maxSize?: number
  key?: (req: Request) => string
}

export function withCache(
  options: WithCacheOptions,
  handler: (req: Request, res: Response) => void | Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  const { ttl, maxSize = CACHE_MAX_DEFAULT, key: keyFn } = options
  const store = createStore(maxSize)

  return async (req, res) => {
    const key = keyFn ? keyFn(req) : defaultCacheKey(req)
    const cached = store.get(key)

    if (cached) {
      replayEntry(res, cached)
      return
    }

    interceptResponse(res, (partial) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, { ...partial, expiresAt: Date.now() + ttl * 1000 })
      }
    })

    await handler(req, res)
  }
}

export { createStore, interceptResponse, replayEntry }
export type { CacheEntry, Store }
