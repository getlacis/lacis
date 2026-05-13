import { cpSync, existsSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { readdirSync, statSync } from 'fs'

type Platform = 'netlify' | 'vercel' | null

const __dirname = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(__dirname, 'templates')

function listFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...listFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

function copyTemplate(templateName: string, dest: string): void {
  const src = join(templatesDir, templateName)
  const files = listFiles(src)
  let created = 0
  let skipped = 0

  for (const srcFile of files) {
    const rel = relative(src, srcFile)
    const destFile = join(dest, rel)

    if (existsSync(destFile)) {
      console.log(`  skip   ${rel}`)
      skipped++
    } else {
      cpSync(srcFile, destFile, { recursive: true })
      console.log(`  create ${rel}`)
      created++
    }
  }

  console.log(`\n${created} file(s) created, ${skipped} skipped.`)
}

export function init(platform: Platform, cwd: string): void {
  if (platform === 'netlify') {
    console.log('[zeno] Scaffolding Netlify adapter...\n')
    copyTemplate('netlify', cwd)
    console.log('\nNext steps:')
    console.log('  zeno build   # generate routes/_manifest.ts')
    console.log('  zeno dev     # start dev server (runs netlify dev)')
  } else if (platform === 'vercel') {
    console.log('[zeno] Scaffolding Vercel adapter...\n')
    copyTemplate('vercel', cwd)
    console.log('\nNext steps:')
    console.log('  zeno build   # generate routes/_manifest.ts')
    console.log('  zeno dev     # start dev server (runs vercel dev)')
  } else {
    console.log('[zeno] Scaffolding base project...\n')
    copyTemplate('base', cwd)
    console.log('\nNext steps:')
    console.log('  npm install zeno')
    console.log('  zeno dev')
  }
}
