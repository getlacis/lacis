import { unstable_dev } from 'wrangler'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let worker
let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`)
    failed++
  }
}

try {
  console.log('\nStarting worker via wrangler.unstable_dev...')
  worker = await unstable_dev(join(__dirname, 'worker.ts'), {
    config: join(__dirname, 'wrangler.toml'),
    local: true,
    logLevel: 'none',
  })

  console.log('\nGET /  — basic JSON response')
  {
    const res = await worker.fetch('/')
    const body = await res.json()
    assert('status 200', res.status === 200, `got ${res.status}`)
    assert('json body', body.message === 'Hello from lacis on Cloudflare Workers!', JSON.stringify(body))
    assert('content-type json', res.headers.get('content-type')?.includes('application/json'))
  }

  console.log('\nGET /missing  — 404 not found')
  {
    const res = await worker.fetch('/missing')
    const body = await res.json()
    assert('status 404', res.status === 404, `got ${res.status}`)
    assert('error body', body.error === 'Route not found', JSON.stringify(body))
  }

  console.log('\nGET /users/42  — route params')
  {
    const res = await worker.fetch('/users/42')
    const body = await res.json()
    assert('status 200', res.status === 200, `got ${res.status}`)
    assert('param id', body.id === '42', JSON.stringify(body))
  }

  console.log('\nPOST /echo  — request body (json)')
  {
    const res = await worker.fetch('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    const body = await res.json()
    assert('status 200', res.status === 200, `got ${res.status}`)
    assert('echoed body', body.echo?.hello === 'world', JSON.stringify(body))
  }

  console.log('\nGET /  with query string — req.query')
  {
    const res = await worker.fetch('/?foo=bar')
    assert('status 200', res.status === 200)
  }

} finally {
  await worker?.stop()
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
