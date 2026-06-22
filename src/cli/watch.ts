import { watch } from 'fs'
import { generateManifest, generateRouteTypes } from './build.js'

export async function watchRoutes(routesDir: string): Promise<void> {
  await generateManifest(routesDir)
  await generateRouteTypes(routesDir)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(routesDir, { recursive: true }, (_event, filename) => {
    if (!filename || filename === '_manifest.ts') return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      console.log(`[lacis] Route changed: ${filename}, regenerating...`)
      try {
        await generateManifest(routesDir)
        await generateRouteTypes(routesDir)
      } catch (err) {
        console.error('[lacis] Failed to regenerate:', err)
      }
    }, 100)
  })
}
