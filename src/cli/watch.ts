import { watch } from 'fs'
import { generateManifest } from './build.js'

export async function watchRoutes(routesDir: string): Promise<void> {
  await generateManifest(routesDir)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(routesDir, { recursive: true }, (_event, filename) => {
    if (!filename || filename === '_manifest.ts') return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      console.log(`[zeno] Route changed: ${filename}, regenerating manifest...`)
      try {
        await generateManifest(routesDir)
      } catch (err) {
        console.error('[zeno] Failed to regenerate manifest:', err)
      }
    }, 100)
  })
}
