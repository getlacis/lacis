import { router } from "./router"
import type { DefineHandlerConfig } from "./defineHandler"
import { primaryLog } from "@/utils/logs"

export interface OpenApiInfo {
  title: string
  version: string
  description?: string
}

export interface OpenApiConfig {
  path?: string
  info: OpenApiInfo
}

async function schemaToJsonSchema(schema: any): Promise<Record<string, any> | null> {
  const vendor = schema?.["~standard"]?.vendor
  if (!vendor) return null
  try {
    if (vendor === "zod") {
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

async function buildOperation(
  method: string,
  config: DefineHandlerConfig<any, any, any>,
): Promise<Record<string, any>> {
  const op: Record<string, any> = {
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
      for (const [name, propSchema] of Object.entries(jsonSchema.properties)) {
        parameters.push({ name, in: "path", required: true, schema: propSchema })
      }
    }
  }

  if (config.query) {
    const jsonSchema = await schemaToJsonSchema(config.query)
    if (jsonSchema?.properties) {
      const required: string[] = jsonSchema.required ?? []
      for (const [name, propSchema] of Object.entries(jsonSchema.properties)) {
        parameters.push({ name, in: "query", required: required.includes(name), schema: propSchema })
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
      ? await buildOperation(method, defineConfig)
      : { responses: { "200": { description: "Success" } } }
  }

  return { openapi: "3.1.0", info: config.info, paths }
}
