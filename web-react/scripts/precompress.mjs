// Precompress once at build time; the app and nginx reuse the same artifacts.
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const pdfPackage = JSON.parse(await readFile(new URL('../node_modules/pdfjs-dist/package.json', import.meta.url), 'utf8'))
const pdfVersion = pdfPackage.version
if (pdfVersion !== '6.4.299') throw new Error(`pdfjs-dist ${pdfVersion} does not match /pdfjs/6.4.299/ paths in AttachmentPreview`)
const pdfTarget = new URL(`../../web/dist/pdfjs/${pdfVersion}/`, import.meta.url)
await mkdir(pdfTarget, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url), new URL(`${directory}/`, pdfTarget), { recursive: true })
}

const root = new URL('../../web/dist/assets/', import.meta.url)
let count = 0, rawBytes = 0, brBytes = 0
for (const file of await readdir(root)) {
  if (!/\.(js|mjs|css|svg|json)$/.test(file)) continue
  const source = await readFile(new URL(file, root))
  if (source.length < 2048) continue
  const gzip = gzipSync(source, { level: 9 })
  const br = brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 8 } })
  await writeFile(new URL(file + '.gz', root), gzip)
  await writeFile(new URL(file + '.br', root), br)
  count++; rawBytes += source.length; brBytes += br.length
}
console.log(`Precompressed ${count} assets: ${(rawBytes / 1024 / 1024).toFixed(1)} MB → ${(brBytes / 1024 / 1024).toFixed(1)} MB Brotli`)
