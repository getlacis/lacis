import { defineHandler } from '@/core/defineHandler'
import { createTestApp } from './helpers/server'

function arktypeSchema(jsonSchema: Record<string, any>) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'arktype',
      validate: (v: unknown) => ({ value: v }),
      types: undefined as any,
    },
    toJsonSchema: () => jsonSchema,
  }
}

describe('OpenAPI endpoint', () => {
  it('serves the OpenAPI doc at /openapi.json', async () => {
    const { request, close } = await createTestApp({
      routes: [],
      openapi: { info: { title: 'Test API', version: '0.1.0' } },
    })
    const { body } = await request.get('/openapi.json').expect(200)
    expect(body.openapi).toBe('3.1.0')
    expect(body.info.title).toBe('Test API')
    expect(body.paths).toBeDefined()
    await close()
  })

  it('serves at a custom path when configured', async () => {
    const { request, close } = await createTestApp({
      routes: [],
      openapi: { path: '/docs/api.json', info: { title: 'T', version: '0' } },
    })
    await request.get('/docs/api.json').expect(200)
    await request.get('/openapi.json').expect(404)
    await close()
  })

  it('includes registered routes in the doc', async () => {
    const { request, close } = await createTestApp({
      routes: [{ path: '/users', handlers: { GET: async (_req: any, res: any) => res.json([]) } }],
      openapi: { info: { title: 'T', version: '0' } },
    })
    const { body } = await request.get('/openapi.json').expect(200)
    expect(body.paths['/users']).toBeDefined()
    expect(body.paths['/users'].get).toBeDefined()
    await close()
  })

  it('includes defineHandler meta in the doc', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/users',
        handlers: {
          GET: defineHandler({
            meta: { summary: 'List users', tags: ['users'] },
            handler: async (_req, res) => res.json([]),
          }) as any,
        },
      }],
      openapi: { info: { title: 'T', version: '0' } },
    })
    const { body } = await request.get('/openapi.json').expect(200)
    expect(body.paths['/users'].get.summary).toBe('List users')
    expect(body.paths['/users'].get.tags).toEqual(['users'])
    await close()
  })

  it('includes path params from defineHandler schema', async () => {
    const { request, close } = await createTestApp({
      routes: [{
        path: '/users/:id',
        handlers: {
          GET: defineHandler({
            params: arktypeSchema({
              type: 'object',
              properties: { id: { type: 'string' } },
            }) as any,
            handler: async (_req, res) => res.json({}),
          }) as any,
        },
      }],
      openapi: { info: { title: 'T', version: '0' } },
    })
    const { body } = await request.get('/openapi.json').expect(200)
    expect(body.paths['/users/{id}']).toBeDefined()
    const params = body.paths['/users/{id}'].get.parameters
    expect(params).toContainEqual(expect.objectContaining({ name: 'id', in: 'path' }))
    await close()
  })

  it('the openapi route itself does not appear in the doc paths', async () => {
    const { request, close } = await createTestApp({
      routes: [],
      openapi: { info: { title: 'T', version: '0' } },
    })
    const { body } = await request.get('/openapi.json').expect(200)
    expect(body.paths['/openapi.json']).toBeUndefined()
    await close()
  })
})
