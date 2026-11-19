import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const outputDir = path.resolve('dist-electron/preload')
const temporaryDir = path.resolve('dist-electron/preload-cjs')
const source = path.join(temporaryDir, 'preload', 'preload.js')
const target = path.join(outputDir, 'preload.cjs')

await access(source)
await mkdir(outputDir, { recursive: true })
await rm(target, { force: true })
await rename(source, target)
await rm(path.join(outputDir, 'preload.js'), { force: true })
await rm(temporaryDir, { recursive: true, force: true })
