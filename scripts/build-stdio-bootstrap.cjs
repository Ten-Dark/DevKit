const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const temporaryOutput = path.join(root, 'dist-electron', 'mcp-bootstrap-cjs')
const source = path.join(root, 'src', 'main', 'mcp', 'stdio-bootstrap.ts')
const destinationDirectory = path.join(root, 'dist-electron', 'main', 'mcp')
const destination = path.join(destinationDirectory, 'stdio-bootstrap.cjs')
const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

fs.rmSync(temporaryOutput, { recursive: true, force: true })
fs.mkdirSync(temporaryOutput, { recursive: true })
fs.mkdirSync(destinationDirectory, { recursive: true })

try {
  execFileSync(process.execPath, [
    compiler,
    '--target', 'ES2022',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--outDir', temporaryOutput,
    '--skipLibCheck',
    '--esModuleInterop',
    '--types', 'node',
    source,
  ], { cwd: root, stdio: 'inherit' })

  const compiled = path.join(temporaryOutput, 'stdio-bootstrap.js')
  if (!fs.existsSync(compiled)) throw new Error('TypeScript did not emit the MCP stdio bootstrap.')
  fs.copyFileSync(compiled, destination)
  console.log('Built CommonJS MCP stdio bootstrap:', path.relative(root, destination))
} finally {
  fs.rmSync(temporaryOutput, { recursive: true, force: true })
}
