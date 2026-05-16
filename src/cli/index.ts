import { resolve } from 'path'
import { generateManifest } from './build.js'
import { watchRoutes } from './watch.js'
import { dev } from './dev.js'

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const command = args[0] ?? ''

  const routesFlagIndex = args.indexOf('--routes')
  const routesDirArg =
    routesFlagIndex !== -1 ? args[routesFlagIndex + 1] : undefined

  const routesDir = routesDirArg
    ? resolve(process.cwd(), routesDirArg)
    : resolve(process.cwd(), 'routes')

  return { command, routesDir }
}

function printHelp() {
  console.log(`
Usage: lacis <command> [options]

Commands:
  build             Generate routes/_manifest.ts
  watch             Watch routes and regenerate manifest on changes
  dev               Auto-detect platform and start dev server

To scaffold a new project: npm create lacis@latest

Options:
  --routes <dir>    Path to routes directory (default: ./routes)
`)
}

async function main() {
  const { command, routesDir } = parseArgs(process.argv)

  switch (command) {
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
  console.error('[lacis]', err)
  process.exit(1)
})
