import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const source = dirname(require.resolve('pdfjs-dist/package.json'))
const { version } = require('pdfjs-dist/package.json')
const target = fileURLToPath(new URL(`../public/pdfjs/${version}/`, import.meta.url))
await mkdir(target, { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(join(source, folder), join(target, folder), { recursive: true })
}
console.log(`PDF.js ${version}: local preview assets prepared`)
