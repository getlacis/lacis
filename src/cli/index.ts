import { resolve } from 'path'
import { generateManifest } from './build.js'
import { watchRoutes } from './watch.js'
import { dev } from './dev.js'
import { init } from './init.js'

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const command = args[0] ?? ''
  const subcommand = args[1] ?? null

  const routesFlagIndex = args.indexOf('--routes')
  const routesDirArg =
    routesFlagIndex !== -1 ? args[routesFlagIndex + 1] : undefined

  const routesDir = routesDirArg
    ? resolve(process.cwd(), routesDirArg)
    : resolve(process.cwd(), 'routes')

  return { command, subcommand, routesDir }
}

function printHelp() {
  console.log(`
Usage: zeno <command> [options]

Commands:
  init              Scaffold a base zeno project
  init netlify      Add Netlify adapter files
  init vercel       Add Vercel adapter files
  build             Generate routes/_manifest.ts
  watch             Watch routes and regenerate manifest on changes
  dev               Auto-detect platform and start dev server

Options:
  --routes <dir>    Path to routes directory (default: ./routes)
`)
}

async function main() {
  const { command, subcommand, routesDir } = parseArgs(process.argv)

  switch (command) {
    case 'init': {
      const platform =
        subcommand === 'netlify' ? 'netlify'
        : subcommand === 'vercel' ? 'vercel'
        : subcommand !== null ? (console.error(`Unknown platform: ${subcommand}`), process.exit(1))
        : null
      init(platform, process.cwd())
      break
    }
    case 'build':
      await generateManifest(routesDir)
      break
    case 'watch':
      await watchRoutes(routesDir)
      break
    case 'dev':
      await dev(routesDir)
      break
    default:
      printHelp()
      if (command) {
        console.error(`Unknown command: ${command}`)
        process.exit(1)
      }
  }
}

main().catch((err) => {
  console.error('[zeno]', err)
  process.exit(1)
})
