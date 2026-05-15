import cluster from 'cluster'

jest.mock('cluster', () => ({ isPrimary: true }))
jest.mock('@/core/router', () => ({
  loadRoutes: jest.fn().mockResolvedValue(true),
  router: { addRoute: jest.fn() },
}))
jest.mock('@/core/openapi', () => ({ buildOpenApiDoc: jest.fn() }))
jest.mock('@/adapters', () => ({
  getAdapter: () => ({
    createHandler: () => () => ({ listen: jest.fn(), on: jest.fn() }),
  }),
}))
jest.mock('@/utils/logs', () => ({ primaryLog: jest.fn() }))

describe('createServer — graceful shutdown listeners', () => {
  it('registers SIGINT/SIGTERM/SIGHUP listeners exactly once across multiple createServer calls', async () => {
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGHUP: process.listenerCount('SIGHUP'),
    }

    const { createServer } = await import('@/core/server')
    await createServer('/fake/routes', { platform: 'node', cluster: { enabled: false }, monitoring: { enabled: false } } as any)
    await createServer('/fake/routes', { platform: 'node', cluster: { enabled: false }, monitoring: { enabled: false } } as any)
    await createServer('/fake/routes', { platform: 'node', cluster: { enabled: false }, monitoring: { enabled: false } } as any)

    expect(process.listenerCount('SIGINT') - before.SIGINT).toBe(1)
    expect(process.listenerCount('SIGTERM') - before.SIGTERM).toBe(1)
    expect(process.listenerCount('SIGHUP') - before.SIGHUP).toBe(1)
  })
})
