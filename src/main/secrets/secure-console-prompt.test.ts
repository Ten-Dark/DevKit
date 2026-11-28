import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { promptForSecureConsolePassword } from './secure-console-prompt.js'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>
  }
  child.kill = vi.fn()
  return child as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> }
}

function fakePipe() {
  let resolve!: (password: string) => void
  let reject!: (error: Error) => void
  const value = new Promise<string>((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  const pipe = {
    path: 'devkit-keepassxc-test-pipe',
    value,
    close: vi.fn(async () => undefined),
  }
  return { pipe, resolve, reject }
}

describe('promptForSecureConsolePassword', () => {
  it('opens a visible PowerShell secure-string prompt and returns UTF-8 password only to Main Process', async () => {
    const child = fakeChild()
    const { pipe, resolve } = fakePipe()
    const spawnImpl = vi.fn((_executable: string, _args: string[], _options: unknown) => child)
    const result = promptForSecureConsolePassword({
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnImpl: spawnImpl as never,
      createPasswordPipe: vi.fn(async () => pipe),
    })

    await Promise.resolve()
    const [executable, args, options] = spawnImpl.mock.calls[0]!
    expect(executable).toBe(path.join('C:\\Windows', 'System32', 'cmd.exe'))
    expect(args[2]).toContain('start "DevKit KeePassXC Unlock" /wait')
    expect(options).toMatchObject({ windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' })
    expect(options).toMatchObject({ windowsHide: true, stdio: 'ignore' })
    const encodedCommand = args[2]!.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/u)?.[1]
    expect(encodedCommand).toBeTruthy()
    const script = Buffer.from(encodedCommand!, 'base64').toString('utf16le')
    expect(script).toContain('Read-Host -Prompt "Enter KeePassXC master password" -AsSecureString')
    expect(script).toContain('NamedPipeClientStream')
    expect(script).toContain(pipe.path)
    expect(script).toContain('ZeroFreeBSTR')
    expect(JSON.stringify(args)).not.toContain('пароль')

    const password = 'māster 密码 123'
    resolve(password)
    await expect(result).resolves.toBe(password)
    expect(pipe.close).toHaveBeenCalledOnce()
  })

  it('rejects on a cancelled prompt without returning partial output', async () => {
    const child = fakeChild()
    const { pipe } = fakePipe()
    const result = promptForSecureConsolePassword({
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnImpl: vi.fn(() => child) as never,
      createPasswordPipe: vi.fn(async () => pipe),
    })
    await Promise.resolve()
    child.emit('close', 2)
    await expect(result).rejects.toThrow('KeePassXC unlock was cancelled.')
  })

  it('rejects if PowerShell cannot be started', async () => {
    const { pipe } = fakePipe()
    await expect(promptForSecureConsolePassword({
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnImpl: vi.fn(() => { throw new Error('spawn failed') }) as never,
      createPasswordPipe: vi.fn(async () => pipe),
    })).rejects.toThrow('Could not open the secure KeePassXC password prompt.')
    expect(pipe.close).toHaveBeenCalledOnce()
  })

  it('does not attempt PowerShell prompting on non-Windows platforms', async () => {
    const spawnImpl = vi.fn()
    const createPipe = vi.fn()
    await expect(promptForSecureConsolePassword({
      platform: 'linux',
      systemRoot: '/usr',
      spawnImpl: spawnImpl as never,
      createPasswordPipe: createPipe,
    })).rejects.toThrow(/only on Windows/u)
    expect(spawnImpl).not.toHaveBeenCalled()
    expect(createPipe).not.toHaveBeenCalled()
  })

  it('rejects oversized prompt output and terminates the prompt process', async () => {
    const child = fakeChild()
    const { pipe, reject } = fakePipe()
    const result = promptForSecureConsolePassword({
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      maxOutputBytes: 128,
      spawnImpl: vi.fn(() => child) as never,
      createPasswordPipe: vi.fn(async () => pipe),
    })
    reject(new Error('Secure KeePassXC prompt output exceeded the supported size limit.'))
    await expect(result).rejects.toThrow(/exceeded the supported size limit/u)
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
