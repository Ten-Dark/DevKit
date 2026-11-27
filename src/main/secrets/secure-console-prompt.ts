import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024

interface PasswordPipe {
  path: string
  value: Promise<string>
  close(): Promise<void>
}

export interface SecureConsolePromptOptions {
  platform?: NodeJS.Platform
  systemRoot?: string
  timeoutMs?: number
  maxOutputBytes?: number
  spawnImpl?: typeof spawn
  createPasswordPipe?: (maxOutputBytes: number) => Promise<PasswordPipe>
}

function createPasswordPipe(maxOutputBytes: number): Promise<PasswordPipe> {
  const pipeName = 'devkit-keepassxc-' + randomUUID()
  const pipePath = '\\\\.\\pipe\\' + pipeName
  const server = net.createServer()
  let resolveValue!: (password: string) => void
  let rejectValue!: (error: Error) => void
  let settled = false
  let payload = ''
  let accepted = false

  const value = new Promise<string>((resolve, reject) => {
    resolveValue = resolve
    rejectValue = reject
  })
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    rejectValue(error)
  }

  server.on('connection', (socket) => {
    if (accepted) {
      socket.destroy()
      return
    }
    accepted = true
    socket.setEncoding('ascii')
    socket.on('data', (chunk: string) => {
      payload += chunk
      if (Buffer.byteLength(payload, 'ascii') > maxOutputBytes) {
        socket.destroy()
        fail(new Error('Secure KeePassXC prompt output exceeded the supported size limit.'))
      }
    })
    socket.on('error', () => fail(new Error('Secure KeePassXC prompt channel failed.')))
    socket.on('end', () => {
      if (settled) return
      const encoded = payload.trim()
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
        fail(new Error('Secure KeePassXC prompt returned an invalid response.'))
        return
      }
      const password = Buffer.from(encoded, 'base64').toString('utf8')
      if (!password || /[\r\n\0]/u.test(password)) {
        fail(new Error('Secure KeePassXC prompt returned an invalid password value.'))
        return
      }
      settled = true
      resolveValue(password)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipePath, () => {
      resolve({
        path: pipeName,
        value,
        close: () => new Promise<void>((closeResolve) => {
          if (!server.listening) {
            closeResolve()
            return
          }
          server.close(() => closeResolve())
        }),
      })
    })
  })
}

function terminateProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => undefined)
  }
  child.kill()
}

export function promptForSecureConsolePassword(options: SecureConsolePromptOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    return Promise.reject(new Error('Secure KeePassXC console prompting is currently supported only on Windows.'))
  }

  const systemRoot = options.systemRoot ?? process.env.SystemRoot
  if (!systemRoot || !path.isAbsolute(systemRoot)) {
    return Promise.reject(new Error('Windows system directory is unavailable; cannot open the secure KeePassXC prompt.'))
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000
    || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 128 || maxOutputBytes > 64 * 1024) {
    return Promise.reject(new Error('Secure KeePassXC prompt limits are invalid.'))
  }

  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const commandProcessorPath = path.join(systemRoot, 'System32', 'cmd.exe')
  const spawnImpl = options.spawnImpl ?? spawn

  return (async () => {
    const pipe = await (options.createPasswordPipe ?? createPasswordPipe)(maxOutputBytes)
    let child: ChildProcess | undefined
    let timeout: NodeJS.Timeout | undefined
    try {
      const script = [
        '$ErrorActionPreference = "Stop"',
        '$secure = Read-Host -Prompt "Enter KeePassXC master password" -AsSecureString',
        'if ($null -eq $secure -or $secure.Length -eq 0) { exit 2 }',
        '$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
        'try {',
        '  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)',
        '  $bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)',
        '  $payload = [Convert]::ToBase64String($bytes) + [string][char]10',
        '  $pipe = [System.IO.Pipes.NamedPipeClientStream]::new(".", "' + pipe.path + '", [System.IO.Pipes.PipeDirection]::Out)',
        '  try {',
        '    $pipe.Connect(10000)',
        '    $wire = [System.Text.Encoding]::ASCII.GetBytes($payload)',
        '    $pipe.Write($wire, 0, $wire.Length)',
        '    $pipe.Flush()',
        '  } finally { $pipe.Dispose() }',
        '} finally {',
        '  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)',
        '  $secure.Dispose()',
        '}',
      ].join('\n')
      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')
      const startCommand = 'start "DevKit KeePassXC Unlock" /wait "' + powershellPath + '" -NoLogo -NoProfile -EncodedCommand ' + encodedCommand

      try {
        child = spawnImpl(commandProcessorPath, ['/d', '/c', startCommand], {
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: 'ignore',
        })
      } catch {
        throw new Error('Could not open the secure KeePassXC password prompt.')
      }

      const processExit = new Promise<never>((_resolve, reject) => {
        child!.on('error', () => reject(new Error('Could not open the secure KeePassXC password prompt.')))
        child!.on('close', (code) => {
          reject(new Error(code === 2
            ? 'KeePassXC unlock was cancelled.'
            : 'Secure KeePassXC password prompt closed before returning a credential.'))
        })
      })
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (child) terminateProcessTree(child)
          reject(new Error('KeePassXC password prompt timed out.'))
        }, timeoutMs)
      })

      return await Promise.race([pipe.value, processExit, timeoutPromise])
    } catch (error) {
      if (child) terminateProcessTree(child)
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      await pipe.close().catch(() => undefined)
    }
  })()
}
