import type { Request, Response } from "@/types"
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
> {
  params?: TParams
  query?: TQuery
  body?: TBody
  responses?: Record<number, StandardSchema>
  meta?: HandlerMeta
  cache?: HandlerCacheOptions
  handler: (
    req: ValidatedRequest<TParams, TQuery, TBody>,
    res: Response
  ) => void | Promise<void>
}

export type DefinedHandler = ((req: Request, res: Response) => Promise<void>) & {
  _defineHandler: DefineHandlerConfig<any, any, any>
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

export function defineHandler<
  TParams extends StandardSchema | undefined = undefined,
  TQuery extends StandardSchema | undefined = undefined,
  TBody extends StandardSchema | undefined = undefined,
>(config: DefineHandlerConfig<TParams, TQuery, TBody>): DefinedHandler {
  const store: Store | null = config.cache ? createStore(config.cache.maxSize ?? 500) : null

  const wrapped = async (req: Request, res: Response): Promise<void> => {
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

    await config.handler(req as ValidatedRequest<TParams, TQuery, TBody>, res)
  }


  // Attached for future OpenAPI generation via CLI
  ;(wrapped as any)._defineHandler = config
  return wrapped as DefinedHandler
}

export type { StandardSchema, StandardIssue, InferOutput, ValidatedRequest }
