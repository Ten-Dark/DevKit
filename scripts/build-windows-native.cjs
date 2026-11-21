const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const targetElectronVersion = String(packageJson.devDependencies.electron).replace(/^[~^]/, '')
const portableNode = path.join(root, '.tools', 'node-v22.23.5-win-x64', 'node.exe')
const buildNode = fs.existsSync(portableNode) ? portableNode : process.execPath
const vswhere = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
)
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
const nativeDirectory = path.join(root, 'native', 'windows-process-control')
const outputDirectory = path.join(root, 'dist-electron', 'main', 'native')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('DevKit Runtime native process control currently supports Windows x64 only.')
}
if (!fs.existsSync(vswhere)) throw new Error('Visual Studio vswhere.exe was not found.')
if (!fs.existsSync(nodeGyp)) throw new Error('Local node-gyp installation was not found.')

const installationPath = execFileSync(vswhere, [
  '-products', '*',
  '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
  '-property', 'installationPath',
], { encoding: 'utf8' }).trim()
if (!installationPath) throw new Error('Visual Studio C++ x64 build tools are required.')

const developerCommandPrompt = path.join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat')
if (!fs.existsSync(developerCommandPrompt)) {
  throw new Error('Visual Studio developer command prompt was not found.')
}

// Run VsDevCmd from a temporary batch file so cmd.exe does not need to parse
// nested quoted executable paths passed through Node's Windows argument escaping.
const environmentScript = path.join(nativeDirectory, 'devkit-vs-env.cmd')
fs.writeFileSync(environmentScript, [
  '@echo off',
  'call "' + developerCommandPrompt + '" -arch=x64 -host_arch=x64',
  'if errorlevel 1 exit /b %errorlevel%',
  'set',
  '',
].join('\r\n'))

let environmentOutput
try {
  environmentOutput = execFileSync(process.env.ComSpec || 'cmd.exe', [
    '/d', '/c', 'devkit-vs-env.cmd',
  ], { cwd: nativeDirectory, encoding: 'utf8', windowsHide: true })
} finally {
  fs.rmSync(environmentScript, { force: true })
}

const buildEnvironment = { ...process.env, GYP_MSVS_VERSION: '2022' }
for (const line of environmentOutput.split(/\r?\n/)) {
  const separator = line.indexOf('=')
  if (separator <= 0) continue
  buildEnvironment[line.slice(0, separator)] = line.slice(separator + 1)
}

const result = spawnSync(buildNode, [
  nodeGyp,
  'rebuild',
  '--target=' + targetElectronVersion,
  '--dist-url=https://electronjs.org/headers',
  '--arch=x64',
  '--runtime=electron',
  '--devdir=' + path.join(os.tmpdir(), 'devkit-electron-gyp'),
], {
  cwd: nativeDirectory,
  stdio: 'inherit',
  env: buildEnvironment,
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const builtAddon = path.join(nativeDirectory, 'build', 'Release', 'windows_process_control.node')
if (!fs.existsSync(builtAddon)) throw new Error('node-gyp completed without producing the native addon.')
fs.mkdirSync(outputDirectory, { recursive: true })
fs.copyFileSync(builtAddon, path.join(outputDirectory, 'windows_process_control.node'))
const nestedHostSource = path.join(nativeDirectory, 'nested_job_host.cc')
const nestedHostOutput = path.join(nativeDirectory, 'build', 'Release', 'nested_job_host.exe')
const compiler = path.join(buildEnvironment.VCToolsInstallDir || '', 'bin', 'Hostx64', 'x64', 'cl.exe')
if (!fs.existsSync(compiler)) throw new Error('MSVC x64 compiler was not found in the Visual Studio environment.')
const compileHost = spawnSync(compiler, [
  '/nologo', '/std:c++17', '/EHsc', '/W4', '/DUNICODE', '/D_UNICODE',
  nestedHostSource,
  '/Fe:' + nestedHostOutput,
  '/Fo:' + path.join(nativeDirectory, 'build', 'Release') + path.sep,
  '/link', 'Kernel32.lib',
], {
  cwd: nativeDirectory,
  stdio: 'inherit',
  env: buildEnvironment,
  windowsHide: true,
})
if (compileHost.error) throw compileHost.error
if (compileHost.status !== 0) process.exit(compileHost.status || 1)

console.log('Built Windows x64 process-control addon and nested-job test host for Electron ' + targetElectronVersion + '.')
