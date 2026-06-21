import { router } from "./router"
import type { DefineHandlerConfig } from "./defineHandler"
import { primaryLog } from "@/utils/logs"

export interface OpenApiInfo {
  title: string
  version: string
  description?: string
}

export interface OpenApiServer {
  url: string
  description?: string
}

export interface OpenApiConfig {
  path?: string
  info: OpenApiInfo
  servers?: OpenApiServer[]
}

async function schemaToJsonSchema(schema: any): Promise<Record<string, any> | null> {
  const vendor = schema?.["~standard"]?.vendor
  if (!vendor) return null
  try {
    if (vendor === "zod") {
      const zod = await import("zod" as any)
      if (typeof zod.toJSONSchema === "function") return zod.toJSONSchema(schema)
      const mod = await import("zod-to-json-schema" as any)
      return (mod.zodToJsonSchema ?? mod.default)(schema, { target: "openApi3" })
    }
    if (vendor === "valibot") {
      const mod = await import("@valibot/to-json-schema" as any)
      return (mod.toJsonSchema ?? mod.default)(schema)
    }
    if (vendor === "arktype") {
      return schema.toJsonSchema()
    }
  } catch {
    primaryLog(`[openapi] no converter found for "${vendor}" — install the matching json-schema package`)
  }
  return null
}

function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)\??/g, "{$1}")
}

const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
}

function statusDescription(code: number): string {
  return STATUS_DESCRIPTIONS[code] ?? "Response"
}

function generateOperationId(method: string, openApiPath: string): string {
  const segments = openApiPath.split("/").filter(Boolean)
  const staticSegs = segments.filter((s) => !s.startsWith("{"))
  const paramSegs = segments.filter((s) => s.startsWith("{")).map((s) => s.slice(1, -1))
  const base = method.toLowerCase() + staticSegs.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")
  const byPart =
    paramSegs.length > 0
      ? "By" + paramSegs.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("And")
      : ""
  return base + byPart
}

function buildParameter(name: string, location: "path" | "query", required: boolean, propSchema: any): Record<string, any> {
  const param: Record<string, any> = { name, in: location, required, schema: propSchema }
  if (propSchema.description) param.description = propSchema.description
  if (propSchema.example !== undefined) param.example = propSchema.example
  return param
}

async function buildOperation(
  method: string,
  openApiPath: string,
  config: DefineHandlerConfig<any, any, any>,
): Promise<Record<string, any>> {
  const op: Record<string, any> = {
    operationId: config.meta?.operationId ?? generateOperationId(method, openApiPath),
    responses: { "200": { description: "Success" } },
  }

  if (config.meta?.summary) op.summary = config.meta.summary
  if (config.meta?.description) op.description = config.meta.description
  if (config.meta?.tags) op.tags = config.meta.tags
  if (config.meta?.deprecated) op.deprecated = config.meta.deprecated

  const parameters: any[] = []

  if (config.params) {
    const jsonSchema = await schemaToJsonSchema(config.params)
    if (jsonSchema?.properties) {
      for (const [name, propSchema] of Object.entries<any>(jsonSchema.properties)) {
        parameters.push(buildParameter(name, "path", true, propSchema))
      }
    }
  }

  if (config.query) {
    const jsonSchema = await schemaToJsonSchema(config.query)
    if (jsonSchema?.properties) {
      const required: string[] = jsonSchema.required ?? []
      for (const [name, propSchema] of Object.entries<any>(jsonSchema.properties)) {
        parameters.push(buildParameter(name, "query", required.includes(name), propSchema))
      }
    }
  }

  if (parameters.length > 0) op.parameters = parameters

  if (config.body) {
    const jsonSchema = await schemaToJsonSchema(config.body)
    if (jsonSchema) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: jsonSchema } },
      }
    }
  }

  if (config.responses) {
    const responsesObj: Record<string, any> = {}
    for (const [status, schema] of Object.entries(config.responses)) {
      const jsonSchema = await schemaToJsonSchema(schema as any)
      responsesObj[status] = jsonSchema
        ? { description: statusDescription(Number(status)), content: { "application/json": { schema: jsonSchema } } }
        : { description: statusDescription(Number(status)) }
    }
    op.responses = responsesObj
  }

  return op
}

export async function buildOpenApiDoc(config: OpenApiConfig): Promise<Record<string, any>> {
  const routes = router.getRoutes()
  const paths: Record<string, any> = {}

  for (const { method, path, handler } of routes) {
    const defineConfig: DefineHandlerConfig<any, any, any> | undefined = (handler as any)._defineHandler
    const openApiPath = toOpenApiPath(path)
    if (!paths[openApiPath]) paths[openApiPath] = {}

    paths[openApiPath][method.toLowerCase()] = defineConfig
      ? await buildOperation(method, openApiPath, defineConfig)
      : { operationId: generateOperationId(method, openApiPath), responses: { "200": { description: "Success" } } }
  }

  const doc: Record<string, any> = { openapi: "3.1.0", info: config.info, paths }
  if (config.servers?.length) doc.servers = config.servers
  return doc
}
