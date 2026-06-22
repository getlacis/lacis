import type { Request, Response, Locals } from "@/types"
import { createStore, interceptResponse, replayEntry, defaultCacheKey } from "./responseCache"
import type { Store } from "./responseCache"

// Inlined to avoid an external dependency on @standard-schema/spec
interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown
    ) => StandardResult<Output> | Promise<StandardResult<Output>>
    // Only present at the type level for inference; always undefined at runtime
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> }

interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}

type InferOutput<T extends StandardSchema> = NonNullable<T["~standard"]["types"]>["output"]

type ValidatedRequest<
  TParams extends StandardSchema | undefined,
  TQuery extends StandardSchema | undefined,
  TBody extends StandardSchema | undefined,
> = Omit<Request, "params" | "query" | "body"> & {
  params: TParams extends StandardSchema
    ? InferOutput<TParams>
    : Record<string, string> | undefined
  query: TQuery extends StandardSchema
    ? InferOutput<TQuery>
    : Record<string, string> | undefined
  body: TBody extends StandardSchema ? InferOutput<TBody> : () => Promise<Buffer>
}

// Typed responses (opt-in): when `responses` is declared, `res` is narrowed so
// that `res.status(code).json(data)` only accepts the schema declared for `code`.
// A single source of truth — `responses` types the handler AND feeds the OpenAPI.
type ResponsesMap = Record<number, StandardSchema>

type ResponseSink<T> = Pick<Response, "setHeader" | "cookies" | "end"> & {
  json(data: T): void
  send(data: T): void
}

type TypedResponse<R extends ResponsesMap> = Omit<Response, "status" | "json" | "send"> & {
  status<S extends keyof R & number>(code: S): ResponseSink<InferOutput<R[S]>>
  json(data: InferOutput<R[keyof R & number]>): void
  send(data: InferOutput<R[keyof R & number]>): void
  // Escape hatch: the untyped Response for streaming / edge cases.
  raw: Response
}

// Per-route middleware with context inference. A `use:` middleware may simply
type UseMiddleware = (req: Request, res: Response) => unknown

// The locals contribution of one middleware = the object part of its return type
// (false / boolean / void / Promise contribute nothing).
type LocalsOf<M> = M extends (...args: any[]) => infer R
  ? Extract<Awaited<R>, object> extends infer C
    ? [C] extends [never] ? {} : C
    : {}
  : {}

// Accumulated locals contributed by a tuple of `use:` middlewares.
type MergedLocals<T extends readonly unknown[]> =
  T extends readonly [infer Head, ...infer Tail]
    ? LocalsOf<Head> & MergedLocals<Tail>
    : {}

export interface HandlerMeta {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  operationId?: string
}

export interface HandlerCacheOptions {
  ttl: number
  maxSize?: number
  key?: (req: Request) => string
}

export interface DefineHandlerConfig<
  TParams extends StandardSchema | undefined = undefined,
  TQuery extends StandardSchema | undefined = undefined,
  TBody extends StandardSchema | undefined = undefined,
  TResponses extends ResponsesMap | undefined = undefined,
  TUse extends readonly UseMiddleware[] = readonly [],
> {
  params?: TParams
  query?: TQuery
  body?: TBody
  responses?: TResponses
  // Per-route, per-method middleware. Runs after the path-based +middleware,
  // before the handler. Returning false (or sending the response) stops the chain;
  // returning an object merges it into req.locals and infers its type for the
  // handler. The variadic `[...TUse]` captures the tuple so contributions can be
  // accumulated per element.
  use?: readonly [...TUse]
  meta?: HandlerMeta
  cache?: HandlerCacheOptions
  handler: (
    req: ValidatedRequest<TParams, TQuery, TBody> & { locals: Locals & MergedLocals<TUse> },
    res: TResponses extends ResponsesMap ? TypedResponse<TResponses> : Response
  ) => void | Promise<void>
}

export type DefinedHandler = ((req: Request, res: Response) => Promise<void>) & {
  _defineHandler: DefineHandlerConfig<any, any, any, any, any>
}

async function runValidation<T>(
  schema: StandardSchema<unknown, T>,
  value: unknown
): Promise<{ success: true; data: T } | { success: false; issues: ReadonlyArray<StandardIssue> }> {
  const result = await schema["~standard"].validate(value)
  if (result.issues) return { success: false, issues: result.issues }
  return { success: true, data: result.value }
}

function formatIssues(issues: ReadonlyArray<StandardIssue>) {
  return Array.from(issues).map((issue) => ({
    message: issue.message,
    path: issue.path ? Array.from(issue.path).map((p) => (typeof p === "object" && "key" in p ? p.key : p)) : undefined,
  }))
}

// Dev-only: wrap json()/send() so a returned body that violates the declared
// schema for the current status code fails loudly. Sync validators throw (the
// adapter turns it into a 500); async validators are best-effort logged.
function installResponseValidation(res: Response, responses: ResponsesMap): void {
  const validate = (data: unknown) => {
    const schema = responses[res.statusCode]
    if (!schema) return
    const result = schema["~standard"].validate(data)
    if (result instanceof Promise) {
      result.then((r) => {
        if (r.issues)
          console.error(
            `[lacis] Response body for status ${res.statusCode} does not match its declared schema:`,
            formatIssues(r.issues),
          )
      })
      return
    }
    if (result.issues) {
      throw Object.assign(
        new Error(`Response body for status ${res.statusCode} does not match its declared schema`),
        { issues: formatIssues(result.issues), status: 500 },
      )
    }
  }

  if (typeof res.json === "function") {
    const origJson = res.json.bind(res)
    res.json = ((data: any) => {
      validate(data)
      return origJson(data)
    }) as Response["json"]
  }

  if (typeof res.send === "function") {
    const origSend = res.send.bind(res)
    res.send = ((data: any) => {
      validate(data)
      return origSend(data)
    }) as Response["send"]
  }
}

export function defineHandler<
  TParams extends StandardSchema | undefined = undefined,
  TQuery extends StandardSchema | undefined = undefined,
  TBody extends StandardSchema | undefined = undefined,
  TResponses extends ResponsesMap | undefined = undefined,
  TUse extends readonly UseMiddleware[] = readonly [],
>(config: DefineHandlerConfig<TParams, TQuery, TBody, TResponses, TUse>): DefinedHandler {
  const store: Store | null = config.cache ? createStore(config.cache.maxSize ?? 500) : null

  const wrapped = async (req: Request, res: Response): Promise<void> => {
    // Typed responses: expose the raw escape hatch, and validate the body against
    // the declared schema in dev only (zero validation in prod — perf).
    if (config.responses) {
      ;(res as any).raw = res
      if (process.env.NODE_ENV !== "production") {
        installResponseValidation(res, config.responses)
      }
    }

    // Per-route middleware: runs after path +middleware, before the handler. A
    // returned object is merged into req.locals (and typed for the handler).
    if (config.use) {
      for (const mw of config.use) {
        const result = await mw(req, res)
        if (result === false || res.headersSent) return
        if (result && typeof result === "object")
          Object.assign((req as any).locals ??= {}, result)
      }
    }
    if (store && config.cache) {
      const key = config.cache.key ? config.cache.key(req) : defaultCacheKey(req)
      const cached = await store.get(key)
      if (cached) {
        replayEntry(res, cached)
        return
      }
      interceptResponse(res, (partial) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          Promise.resolve(store.set(key, { ...partial, expiresAt: Date.now() + config.cache!.ttl * 1000 })).catch(() => {})
        }
      })
    }
    if (config.params) {
      const result = await runValidation(config.params, req.params ?? {})
      if (!result.success) {
        res.status(400).json({ error: "Validation failed", issues: formatIssues(result.issues) })
        return
      }
      ;(req as any).params = result.data
    }

    if (config.query) {
      const result = await runValidation(config.query, req.query ?? {})
      if (!result.success) {
        res.status(400).json({ error: "Validation failed", issues: formatIssues(result.issues) })
        return
      }
      ;(req as any).query = result.data
    }

    if (config.body) {
      let rawBody: unknown
      try {
        rawBody = await req.json()
      } catch {
        res.status(400).json({ error: "Invalid JSON body" })
        return
      }
      const result = await runValidation(config.body, rawBody)
      if (!result.success) {
        res.status(400).json({ error: "Validation failed", issues: formatIssues(result.issues) })
        return
      }
      ;(req as any).body = result.data
    }

    await config.handler(req as any, res as any)
  }


  // Attached for future OpenAPI generation via CLI
  ;(wrapped as any)._defineHandler = config
  return wrapped as DefinedHandler
}

export type { StandardSchema, StandardIssue, InferOutput, ValidatedRequest }
