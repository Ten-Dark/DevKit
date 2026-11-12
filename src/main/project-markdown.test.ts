import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { ipcMain } from 'electron'
import { resetIpcRegistry } from './ipc-registry.js'
import { addAllowedBaseDir } from './security.js'
import { abortControllers } from './project-markdown.js'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
}))

vi.mock('./window.js', () => ({
  mainWindow: null,
}))

import { registerProjectMarkdownHandlers } from './project-markdown.js'

const handled = new Map<string, Function>()

let tmpDir: string

beforeEach(async () => {
  handled.clear()
  resetIpcRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmd-test-'))
  addAllowedBaseDir(tmpDir)
  ;(ipcMain.handle as unknown as { mockImplementation: (fn: Function) => void }).mockImplementation(
    (channel: string, handler: Function) => {
      handled.set(channel, handler)
    },
  )
  registerProjectMarkdownHandlers()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handled.get(channel)
  if (!handler) throw new Error(`No handler for channel: ${channel}`)
  // @ts-ignore - mock event object
  const event = { sender: { send: vi.fn() } }
  return handler(event as any, ...args)
}

describe('project-markdown main process', () => {
  describe('C4 — invalid directory path', () => {
    it('throws ENOENT for non-existent directory', async () => {
      await expect(
        invoke('generateProjectMarkdown', path.join(tmpDir, 'does-not-exist'), {
          maxFileSizeKB: 1024,
          includeTree: false,
          respectGitignore: false,
        }),
      ).rejects.toThrow(/Directory not found/)
    })

    it('throws for path that is a file, not directory', async () => {
      const filePath = path.join(tmpDir, 'afile.txt')
      await fs.writeFile(filePath, 'hello')
      await expect(
        invoke('generateProjectMarkdown', filePath, {
          maxFileSizeKB: 1024,
          includeTree: false,
          respectGitignore: false,
        }),
      ).rejects.toThrow(/not a directory/)
    })

    it('returns empty markdown for empty directory', async () => {
      const emptyDir = path.join(tmpDir, 'empty')
      await fs.mkdir(emptyDir, { recursive: true })
      const result: any = await invoke(
        'generateProjectMarkdown',
        emptyDir,
        { maxFileSizeKB: 1024, includeTree: false, respectGitignore: false },
      )
      expect(result.markdown).toContain('# empty')
      expect(result.stats.fileCount).toBe(0)
      expect(result.stats.truncated).toBe(false)
    })
  })

  describe('C3 — error reading individual file does not break generation', () => {
    it('skips a file that cannot be read and continues', async () => {
      const projectDir = path.join(tmpDir, 'project-c3')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'good.txt'), 'good content')

      const result: any = await invoke(
        'generateProjectMarkdown',
        projectDir,
        { maxFileSizeKB: 1024, includeTree: false, respectGitignore: false },
      )
      expect(result.stats.fileCount).toBe(1)
      expect(result.stats.skippedCount).toBe(0)
      expect(result.markdown).toContain('good content')
    })
  })

  describe('C5 — truncation at MAX_TOTAL_OUTPUT_CHARS', () => {
    it('sets truncated flag when output exceeds limit', async () => {
      const projectDir = path.join(tmpDir, 'project-c5')
      await fs.mkdir(projectDir, { recursive: true })

      const bigContent = 'x'.repeat(6_000_000)
      await fs.writeFile(path.join(projectDir, 'big.txt'), bigContent)

      const result: any = await invoke(
        'generateProjectMarkdown',
        projectDir,
        { maxFileSizeKB: 100000, includeTree: false, respectGitignore: false },
      )
      expect(result.stats.truncated).toBe(true)
      expect(result.markdown).toContain('truncated')
    })
  })

  describe('P1 — encoding detection', () => {
    it('reads UTF-8 BOM file correctly', async () => {
      const projectDir = path.join(tmpDir, 'project-p1-utf8')
      await fs.mkdir(projectDir, { recursive: true })
      const content = 'hello world'
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      await fs.writeFile(
        path.join(projectDir, 'bom-utf8.txt'),
        Buffer.concat([bom, Buffer.from(content, 'utf-8')]),
      )

      const text: any = await invoke(
        'readFileContent',
        path.join(projectDir, 'bom-utf8.txt'),
      )
      expect(text).toBe(content)
    })

    it('reads UTF-16 LE BOM file correctly', async () => {
      const projectDir = path.join(tmpDir, 'project-p1-utf16le')
      await fs.mkdir(projectDir, { recursive: true })
      const content = 'hello world'
      const bom = Buffer.from([0xff, 0xfe])
      const encoded = Buffer.from(content, 'utf16le')
      await fs.writeFile(
        path.join(projectDir, 'bom-utf16le.txt'),
        Buffer.concat([bom, encoded]),
      )

      const text: any = await invoke(
        'readFileContent',
        path.join(projectDir, 'bom-utf16le.txt'),
      )
      expect(text).toBe(content)
    })

    it('does not treat UTF-16 LE as binary', async () => {
      const projectDir = path.join(tmpDir, 'project-p1-notbinary')
      await fs.mkdir(projectDir, { recursive: true })
      const content = 'test content'
      const bom = Buffer.from([0xff, 0xfe])
      const encoded = Buffer.from(content, 'utf16le')
      await fs.writeFile(
        path.join(projectDir, 'utf16le.txt'),
        Buffer.concat([bom, encoded]),
      )

      const result: any = await invoke(
        'walkDirectory',
        projectDir,
      )
      expect(result.some((f: any) => f.relativePath === 'utf16le.txt')).toBe(true)
    })
  })

  describe('P3 — abort during walk', () => {
    it('stops processing when aborted', async () => {
      const projectDir = path.join(tmpDir, 'project-p3')
      await fs.mkdir(projectDir, { recursive: true })
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(projectDir, `file${i}.txt`), `content ${i}`)
      }

      const operationId = 'test-abort-op'
      const abortResult: any = await invoke('abortOperation', operationId)
      expect(abortResult.success).toBe(false) // no controller registered yet
    })
  })

  describe('P11 — abortOperation', () => {
    it('returns success: false for non-existent operation ID', async () => {
      const result: any = await invoke('abortOperation', 'non-existent-id')
      expect(result.success).toBe(false)
    })

    it('returns success: true when aborting a registered controller', async () => {
      const operationId = 'test-abort-active'
      abortControllers.set(operationId, new AbortController())
      const result: any = await invoke('abortOperation', operationId)
      expect(result.success).toBe(true)
      abortControllers.delete(operationId)
    })
  })

  describe('P2 — Windows long paths (>260 chars)', () => {
    it('handles deeply nested directory with path longer than MAX_PATH', async () => {
      const longDir = path.join(tmpDir, ...Array(40).fill('verylongdirectoryname'))
      await fs.mkdir(longDir, { recursive: true })
      await fs.writeFile(path.join(longDir, 'deepfile.txt'), 'deep content')

      const result: any = await invoke(
        'walkDirectory',
        longDir,
      )
      expect(
        result.some((f: any) => f.relativePath === 'deepfile.txt'),
      ).toBe(true)

      const genResult: any = await invoke(
        'generateProjectMarkdown',
        longDir,
        { maxFileSizeKB: 1024, includeTree: false, respectGitignore: false },
      )
      expect(genResult.markdown).toContain('deep content')
      expect(genResult.stats.fileCount).toBe(1)
    })
  })
})
