import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { watchRoutes } from './watch.js'
import { generateManifest } from './build.js'

function detectPlatform(cwd: string): 'netlify' | 'vercel' | 'node' | 'cloudflare' {
  if (existsSync(join(cwd, 'wrangler.toml'))) return 'cloudflare'
  if (existsSync(join(cwd, 'netlify.toml'))) return 'netlify'
  if (existsSync(join(cwd, 'vercel.json'))) return 'vercel'

  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (allDeps['wrangler']) return 'cloudflare'
    if (allDeps['@netlify/functions'] || allDeps['netlify-cli']) return 'netlify'
    if (allDeps['vercel'] || allDeps['@vercel/node']) return 'vercel'
  } catch {}

  return 'node'
}

export async function dev(routesDir: string): Promise<void> {
  const cwd = process.cwd()

  // Inside vercel dev: regenerate the manifest and exit.
  // vercel dev serves /api functions directly; no dev server is needed.
  if (process.env.VERCEL === '1') {
    await generateManifest(routesDir)
    return
  }

  // Inside netlify dev: generate manifest and start watcher.
  // The file watcher keeps the process alive as a sidecar alongside netlify dev.
  if (process.env.NETLIFY === 'true') {
    await watchRoutes(routesDir)
    return
  }

  const platform = detectPlatform(cwd)

  console.log(`[lacis] Detected platform: ${platform}`)

  // Generate manifest and start watcher before spawning the platform CLI.
  // watchRoutes awaits generateManifest internally, so the manifest exists
  // before vercel dev / netlify dev tries to compile the function entry point.
  await watchRoutes(routesDir)

  if (platform === 'node') {
    console.log('[lacis] Node mode: watching routes for changes...')
    return
  }

  const [cmd, args] =
    platform === 'netlify' ? ['netlify', ['dev']] :
    platform === 'cloudflare' ? ['wrangler', ['dev']] :
    ['vercel', ['dev']]

  const child = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd })

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      const install =
        platform === 'netlify'
          ? 'npm i -g netlify-cli'
          : 'npm i -g vercel'
      console.error(`[lacis] ${cmd} CLI not found. Install it with: ${install}`)
    } else {
      console.error(`[lacis] Failed to start ${cmd} dev:`, err.message)
    }
  })

  const forward = (signal: NodeJS.Signals) => {
    process.on(signal, () => child.kill(signal))
  }
  forward('SIGINT')
  forward('SIGTERM')
}
