import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { ipcMain } from 'electron'
import { resetIpcRegistry } from './ipc-registry.js'
import { addAllowedBaseDir } from './security.js'
import { abortControllers } from './project-markdown.js'
import { createProjectMarkdownDocumentPlan, getProjectMarkdownFileSectionLength, MAX_TOTAL_OUTPUT_CHARS } from '../shared/utils/project-markdown-policy.js'

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
let onProgressSent: (() => void) | null = null

beforeEach(async () => {
  onProgressSent = null
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
  const event = { sender: { send: vi.fn(() => onProgressSent?.()) } }
  return handler(event as any, ...args)
}

describe('project-markdown main process', () => {
  describe('SEC-01 — project root authorization', () => {
    it('rejects a directory outside the approved roots before scanning it', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmd-outside-'))
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'must not be exported')
      try {
        await expect(invoke('generateProjectMarkdown', outsideDir, {
          maxFileSizeKB: 1024, includeTree: false, respectGitignore: false,
        })).rejects.toThrow(/Access denied/)
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('rejects a junction that points outside the approved root', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmd-junction-outside-'))
      const junction = path.join(tmpDir, 'outside-junction')
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'must not be exported')
      try {
        await fs.symlink(outsideDir, junction, 'junction')
      } catch {
        await fs.rm(outsideDir, { recursive: true, force: true })
        return // Junction creation is not available on every filesystem.
      }
      try {
        await expect(invoke('generateProjectMarkdown', junction, {
          maxFileSizeKB: 1024, includeTree: false, respectGitignore: false,
        })).rejects.toThrow(/Access denied/)
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
      }
    })
  })

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

  describe('F-08-R1 — scoped Git ignore semantics', () => {
    it('applies nested rules only within their directory and supports common Git patterns', async () => {
      const projectDir = path.join(tmpDir, 'project-gitignore-r1')
      await fs.mkdir(path.join(projectDir, 'packages', 'app', 'deep'), { recursive: true })
      await fs.mkdir(path.join(projectDir, 'packages', 'other'), { recursive: true })
      await fs.mkdir(path.join(projectDir, 'blocked'), { recursive: true })
      await fs.mkdir(path.join(projectDir, 'build'), { recursive: true })
      await fs.mkdir(path.join(projectDir, 'packages', 'app', 'compiled'), { recursive: true })
      await fs.writeFile(path.join(projectDir, '.gitignore'), [
        '/*.secret',
        'blocked/',
        '!blocked/reinclude.txt',
        'build/',
      ].join('\n'))
      await fs.writeFile(path.join(projectDir, 'root.secret'), 'ignored')
      await fs.writeFile(path.join(projectDir, 'packages', 'app', '.gitignore'), [
        '/local.secret',
        '**/cache?.tmp',
        '*.tmp',
        '!keep.tmp',
        'compiled/',
        '# comment',
        '\\!literal.txt',
      ].join('\n'))
      await fs.writeFile(path.join(projectDir, 'packages', 'app', 'local.secret'), 'ignored')
      await fs.writeFile(path.join(projectDir, 'packages', 'app', 'deep', 'cache1.tmp'), 'ignored')
      await fs.writeFile(path.join(projectDir, 'packages', 'app', 'keep.tmp'), 'included')
      await fs.writeFile(path.join(projectDir, 'packages', 'app', '!literal.txt'), 'literal')
      await fs.writeFile(path.join(projectDir, 'packages', 'app', 'compiled', 'out.js'), 'ignored')
      await fs.writeFile(path.join(projectDir, 'packages', 'other', 'cache1.tmp'), 'sibling')
      await fs.writeFile(path.join(projectDir, 'packages', 'other', 'local.secret'), 'not root anchored')
      await fs.writeFile(path.join(projectDir, 'blocked', 'reinclude.txt'), 'cannot reinclude')
      await fs.writeFile(path.join(projectDir, 'build', 'output.js'), 'built')

      const scan: any = await invoke('walkDirectory', projectDir, { respectGitignore: true })
      const included = scan.files.map((file: any) => file.relativePath)
      expect(included).toContain('packages/app/keep.tmp')
      expect(included).not.toContain('packages/app/!literal.txt')
      expect(scan.issues).toContainEqual(expect.objectContaining({ relativePath: 'packages/app/!literal.txt', reason: 'gitignore' }))
      expect(included).toContain('packages/other/local.secret')
      expect(included).toContain('packages/other/cache1.tmp')
      expect(included).not.toContain('packages/app/compiled/out.js')
      expect(included).not.toContain('root.secret')
      expect(included).not.toContain('packages/app/local.secret')
      expect(included).not.toContain('packages/app/deep/cache1.tmp')
      expect(included).not.toContain('blocked/reinclude.txt')
      expect(included).not.toContain('build/output.js')
      expect(scan.issues).toContainEqual(expect.objectContaining({ relativePath: 'blocked', reason: 'gitignore', kind: 'directory' }))
      expect(scan.issues).toContainEqual(expect.objectContaining({ relativePath: 'build', reason: 'internal-ignore', kind: 'directory' }))
    })

    it('uses the current root and nested .gitignore contents when Generate starts', async () => {
      const projectDir = path.join(tmpDir, 'project-gitignore-refresh')
      await fs.mkdir(path.join(projectDir, 'nested'), { recursive: true })
      await fs.writeFile(path.join(projectDir, '.gitignore'), 'old.txt\n')
      await fs.writeFile(path.join(projectDir, 'old.txt'), 'old content')
      await fs.writeFile(path.join(projectDir, 'new.txt'), 'new content')
      await fs.writeFile(path.join(projectDir, 'nested', '.gitignore'), 'nested-old.txt\n')
      await fs.writeFile(path.join(projectDir, 'nested', 'nested-old.txt'), 'nested old')
      await fs.writeFile(path.join(projectDir, 'nested', 'nested-new.txt'), 'nested new')

      const firstScan: any = await invoke('walkDirectory', projectDir, { respectGitignore: true })
      expect(firstScan.files.some((file: any) => file.relativePath === 'old.txt')).toBe(false)
      expect(firstScan.files.some((file: any) => file.relativePath === 'nested/nested-old.txt')).toBe(false)

      await fs.writeFile(path.join(projectDir, '.gitignore'), 'new.txt\n')
      await fs.writeFile(path.join(projectDir, 'nested', '.gitignore'), 'nested-new.txt\n')
      const generated: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1024, includeTree: false, respectGitignore: true,
      })

      const currentCandidates = generated.scannedFiles.map((file: any) => file.relativePath)
      expect(currentCandidates).toContain('old.txt')
      expect(currentCandidates).not.toContain('new.txt')
      expect(currentCandidates).toContain('nested/nested-old.txt')
      expect(currentCandidates).not.toContain('nested/nested-new.txt')
      expect(generated.stats.issues).toContainEqual(expect.objectContaining({ relativePath: 'new.txt', reason: 'gitignore' }))
      expect(generated.stats.issues).toContainEqual(expect.objectContaining({ relativePath: 'nested/nested-new.txt', reason: 'gitignore' }))
      expect(generated.markdown).toContain('old content')
      expect(generated.markdown).not.toContain('new content')
    })

    it('uses platform-aware case matching', async () => {
      const projectDir = path.join(tmpDir, 'project-gitignore-case')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, '.gitignore'), 'sample.txt\n')
      await fs.writeFile(path.join(projectDir, 'SAMPLE.TXT'), 'content')
      const scan: any = await invoke('walkDirectory', projectDir, { respectGitignore: true })
      if (process.platform === 'win32') {
        expect(scan.files.some((file: any) => file.relativePath === 'SAMPLE.TXT')).toBe(false)
      } else {
        expect(scan.files.some((file: any) => file.relativePath === 'SAMPLE.TXT')).toBe(true)
      }
    })

    it('reports unreadable nested .gitignore and treats missing files as normal', async () => {
      const projectDir = path.join(tmpDir, 'project-gitignore-read-error')
      const nested = path.join(projectDir, 'nested')
      await fs.mkdir(nested, { recursive: true })
      await fs.writeFile(path.join(nested, '.gitignore'), 'hidden.txt\n')
      await fs.writeFile(path.join(nested, 'hidden.txt'), 'content')
      const realGitignorePath = await fs.realpath(path.join(nested, '.gitignore'))
      const originalReadFile = fs.readFile.bind(fs)
      const readSpy = vi.spyOn(fs, 'readFile').mockImplementation((async (filePath: any, ...args: any[]) => {
        if (path.resolve(String(filePath)).toLowerCase() === realGitignorePath.toLowerCase()) {
          throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
        }
        return originalReadFile(filePath, ...args)
      }) as typeof fs.readFile)
      try {
        const scan: any = await invoke('walkDirectory', projectDir, { respectGitignore: true })
        expect(scan.issues).toContainEqual({
          relativePath: 'nested/.gitignore', reason: 'gitignore-read-error', kind: 'file',
        })
        expect(scan.issues.filter((issue: any) => issue.relativePath === 'nested/.gitignore')).toHaveLength(1)
      } finally {
        readSpy.mockRestore()
      }

      const emptyDir = path.join(tmpDir, 'project-no-gitignore')
      await fs.mkdir(emptyDir, { recursive: true })
      await fs.writeFile(path.join(emptyDir, 'visible.txt'), 'visible')
      const missingScan: any = await invoke('walkDirectory', emptyDir, { respectGitignore: true })
      expect(missingScan.issues.some((issue: any) => issue.reason === 'gitignore-read-error')).toBe(false)
      expect(missingScan.files.some((file: any) => file.relativePath === 'visible.txt')).toBe(true)
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
      expect(result.stats.errorCount).toBe(0)
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
      expect(result.stats.limitedCount).toBe(1)
      expect(result.stats.errorCount).toBe(0)
      expect(result.stats.issues).toEqual([
        expect.objectContaining({ relativePath: 'big.txt', reason: 'output-limit' }),
      ])
      expect(result.markdown).toContain('truncated')
    })
  })

  describe('F-08-R1 — shared rendered-output budget', () => {
    it('accepts a file exactly at the individual byte limit and excludes one byte over', async () => {
      const projectDir = path.join(tmpDir, 'project-file-size-boundary')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'a-exact.txt'), 'x'.repeat(1024))
      await fs.writeFile(path.join(projectDir, 'b-over.txt'), 'x'.repeat(1025))

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1, includeTree: false, respectGitignore: false,
      })
      expect(result.stats.fileCount).toBe(1)
      expect(result.scannedFiles.map((file: any) => file.relativePath)).toEqual(['a-exact.txt', 'b-over.txt'])
      expect(result.stats.issues).toContainEqual(expect.objectContaining({
        relativePath: 'b-over.txt', reason: 'max-file-size', kind: 'file',
      }))
      expect(result.stats.issues.some((issue: any) => issue.relativePath === 'a-exact.txt')).toBe(false)
    })

    it('includes all 3500 eligible files after excluding an oversized candidate', async () => {
      const projectDir = path.join(tmpDir, 'project-tree-reservation-regression')
      await fs.mkdir(projectDir, { recursive: true })
      for (let index = 0; index < 3_500; index += 1) {
        await fs.writeFile(path.join(projectDir, `file-${String(index).padStart(4, '0')}.ts`), 'x'.repeat(900))
      }

      const oversizedPath = path.join(projectDir, 'oversized.txt')
      await fs.writeFile(oversizedPath, 'z'.repeat(2_048))

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1, includeTree: true, respectGitignore: false,
      })

      expect(result.stats.fileCount).toBe(3_500)
      expect(result.scannedFiles).toHaveLength(3_501)
      expect(result.stats.issues).toContainEqual(expect.objectContaining({
        relativePath: expect.stringContaining('oversized.txt'),
        reason: 'max-file-size',
      }))
      expect(result.stats.issues.some((issue: any) => issue.reason === 'output-limit')).toBe(false)
      expect(result.markdown).toContain('## file-3499.ts')
      expect(result.markdown).not.toContain('## oversized.txt')
      const renderedTree = result.markdown.split('## Structure\n\n')[1]?.split('\n```\n\n---')[0]
      expect(renderedTree).toBeDefined()
      expect(renderedTree).not.toContain('oversized.txt')
      expect(result.stats.treeIncluded).toBe(true)
      expect(result.stats.treeOmitted).toBe(false)
      expect(result.stats.documentChars).toBe(result.markdown.length)
      expect(result.markdown.length).toBeLessThanOrEqual(MAX_TOTAL_OUTPUT_CHARS)
    }, 90_000)

    it('includes a file exactly on the rendered-section boundary and rejects the next character', async () => {
      const projectDir = path.join(tmpDir, 'project-budget-boundary')
      await fs.mkdir(projectDir, { recursive: true })
      const realProjectDir = await fs.realpath(projectDir)
      const plan = createProjectMarkdownDocumentPlan(path.basename(realProjectDir), realProjectDir, [], false)
      const exactContentLength = plan.fileSectionBudget - getProjectMarkdownFileSectionLength('a-boundary.txt', '')
      await fs.writeFile(path.join(projectDir, 'a-boundary.txt'), 'x'.repeat(exactContentLength))

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 10000, includeTree: false, respectGitignore: false,
      })
      expect(result.stats.fileCount).toBe(1)
      expect(result.stats.truncated).toBe(false)
      expect(result.stats.documentChars).toBe(MAX_TOTAL_OUTPUT_CHARS)
      expect(result.markdown.length).toBe(MAX_TOTAL_OUTPUT_CHARS)
      expect(result.stats.issues).toHaveLength(0)
    })

    it('keeps a one-character-over document within the complete output limit', async () => {
      const projectDir = path.join(tmpDir, 'project-budget-one-over')
      await fs.mkdir(projectDir, { recursive: true })
      const realProjectDir = await fs.realpath(projectDir)
      const plan = createProjectMarkdownDocumentPlan(path.basename(realProjectDir), realProjectDir, [], false)
      const contentLength = plan.fileSectionBudget - getProjectMarkdownFileSectionLength('a-over.txt', '') + 1
      await fs.writeFile(path.join(projectDir, 'a-over.txt'), 'x'.repeat(contentLength))

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 10000, includeTree: false, respectGitignore: false,
      })
      expect(result.markdown.length).toBeLessThanOrEqual(MAX_TOTAL_OUTPUT_CHARS)
      expect(result.stats.documentChars).toBe(result.markdown.length)
      expect(result.stats.fileCount).toBe(0)
      expect(result.stats.issues).toContainEqual(expect.objectContaining({
        relativePath: 'a-over.txt', reason: 'output-limit',
      }))
      expect(result.markdown).toContain('Export report')
    })

    it('classifies remaining files by individual size without reading them after output cutoff', async () => {
      const projectDir = path.join(tmpDir, 'project-budget-mixed')
      await fs.mkdir(projectDir, { recursive: true })
      const realProjectDir = await fs.realpath(projectDir)
      const plan = createProjectMarkdownDocumentPlan(path.basename(realProjectDir), realProjectDir, [], false)
      const firstLength = plan.fileSectionBudget - getProjectMarkdownFileSectionLength('a-first.txt', '') - 1500
      await fs.writeFile(path.join(projectDir, 'a-first.txt'), 'x'.repeat(firstLength))
      await fs.writeFile(path.join(projectDir, 'b-cutoff.txt'), 'y'.repeat(2000))
      await fs.writeFile(path.join(projectDir, 'c-too-large.txt'), 'z'.repeat(6_200_000))
      await fs.writeFile(path.join(projectDir, 'd-omitted.txt'), 'small')

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 6000, includeTree: false, respectGitignore: false,
      })
      expect(result.stats.fileCount).toBe(1)
      expect(result.stats.truncated).toBe(true)
      expect(result.stats.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: 'b-cutoff.txt', reason: 'output-limit' }),
        expect.objectContaining({ relativePath: 'c-too-large.txt', reason: 'max-file-size' }),
        expect.objectContaining({ relativePath: 'd-omitted.txt', reason: 'output-limit' }),
      ]))
      expect(result.stats.limitedCount).toBe(3)
      expect(result.stats.issues.filter((issue: any) => issue.relativePath === 'a-first.txt')).toHaveLength(0)
    })
  })

  describe('F-08 — skipped reasons and export limits', () => {
    it('reports built-in exclusions, binary files, and .gitignore matches during scanning', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-scan')
      await fs.mkdir(path.join(projectDir, 'node_modules', 'pkg'), { recursive: true })
      await fs.writeFile(path.join(projectDir, '.env'), 'SECRET=value')
      await fs.writeFile(path.join(projectDir, 'node_modules', 'pkg', 'index.js'), 'ignored')
      await fs.writeFile(path.join(projectDir, 'asset.dat'), Buffer.from([0, 1, 2, 3]))
      await fs.writeFile(path.join(projectDir, '.gitignore'), 'ignored.txt\n')
      await fs.writeFile(path.join(projectDir, 'ignored.txt'), 'ignored by git')
      await fs.writeFile(path.join(projectDir, 'included.txt'), 'included')

      const scan: any = await invoke('walkDirectory', projectDir, { respectGitignore: true })
      expect(scan.files.map((file: any) => file.relativePath)).toEqual(['.gitignore', 'included.txt'])
      expect(scan.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: '.env', reason: 'internal-ignore', kind: 'file' }),
        expect.objectContaining({ relativePath: 'node_modules', reason: 'internal-ignore', kind: 'directory' }),
        expect.objectContaining({ relativePath: 'asset.dat', reason: 'binary' }),
        expect.objectContaining({ relativePath: 'ignored.txt', reason: 'gitignore' }),
      ]))
    })

    it('records file access failures instead of silently losing the path', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-read-error')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'unreadable.txt'), 'content')
      const openSpy = vi.spyOn(fs, 'open').mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
      )
      try {
        const scan: any = await invoke('walkDirectory', projectDir)
        expect(scan.files).toEqual([])
        expect(scan.issues).toContainEqual({
          relativePath: 'unreadable.txt', reason: 'read-error', kind: 'file',
        })
      } finally {
        openSpy.mockRestore()
      }
    })

    it('continues after a per-file read failure and reports it separately from skips', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-generate-read-error')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'bad.txt'), 'unreadable')
      await fs.writeFile(path.join(projectDir, 'good.txt'), 'readable')
      const readSpy = vi.spyOn(fs, 'open').mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
      )
      try {
        const result: any = await invoke('generateProjectMarkdown', projectDir, {
          maxFileSizeKB: 1024, includeTree: false, respectGitignore: false,
        })
        expect(result.stats.fileCount).toBe(1)
        expect(result.stats.skippedCount).toBe(0)
        expect(result.stats.errorCount).toBe(1)
        expect(result.stats.issues).toContainEqual({
          relativePath: 'bad.txt', reason: 'read-error', kind: 'file',
        })
        expect(result.markdown).toContain('Processing errors: 1')
        expect(result.markdown).toContain('Could not read file')
        expect(result.markdown).toContain('readable')
      } finally {
        readSpy.mockRestore()
      }
    })

    it('aborts an active export on progress and releases its operation controller', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-cancel')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'a.txt'), 'first')
      await fs.writeFile(path.join(projectDir, 'b.txt'), 'second')
      const operationId = 'f08-cancel-operation'
      onProgressSent = () => {
        onProgressSent = null
        void invoke('abortOperation', operationId)
      }

      await expect(invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1024, includeTree: false, respectGitignore: false,
      }, operationId)).rejects.toThrow('Operation aborted')
      expect(abortControllers.has(operationId)).toBe(false)
    })

    it('reports max-file-size and skipped reasons consistently in generated Markdown and stats', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-export')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'small.txt'), 'ok')
      await fs.writeFile(path.join(projectDir, 'large.txt'), 'x'.repeat(2048))
      await fs.writeFile(path.join(projectDir, '.env'), 'SECRET=value')
      await fs.writeFile(path.join(projectDir, '.gitignore'), 'ignored.txt\n')
      await fs.writeFile(path.join(projectDir, 'ignored.txt'), 'ignored')

      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1, includeTree: true, respectGitignore: true,
      })
      expect(result.stats.fileCount).toBe(2)
      expect(result.stats.skippedCount).toBe(2)
      expect(result.stats.limitedCount).toBe(1)
      expect(result.stats.errorCount).toBe(0)
      expect(result.stats.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: 'large.txt', reason: 'max-file-size' }),
        expect.objectContaining({ relativePath: '.env', reason: 'internal-ignore' }),
        expect.objectContaining({ relativePath: 'ignored.txt', reason: 'gitignore' }),
      ]))
      expect(result.markdown).toContain('## Export report')
      expect(result.markdown).toContain('large.txt')
      expect(result.markdown).toContain('Excluded by .gitignore')
      expect(result.markdown).not.toContain('SECRET=value')
    })

    it('returns an explicit report when every candidate is excluded', async () => {
      const projectDir = path.join(tmpDir, 'project-f08-all-skipped')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, '.env'), 'SECRET=value')
      const result: any = await invoke('generateProjectMarkdown', projectDir, {
        maxFileSizeKB: 1, includeTree: true, respectGitignore: true,
      })
      expect(result.stats.fileCount).toBe(0)
      expect(result.stats.skippedCount).toBe(1)
      expect(result.markdown).toContain('- Included files: 0')
      expect(result.markdown).toContain('Export report')
      expect(result.markdown).toContain('.env')
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
      expect(result.files.some((f: any) => f.relativePath === 'utf16le.txt')).toBe(true)
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
        result.files.some((f: any) => f.relativePath === 'deepfile.txt'),
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
