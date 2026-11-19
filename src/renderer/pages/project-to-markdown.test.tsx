// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectToMarkdownPage from './project-to-markdown'
import {
  createProjectMarkdownDocumentPlan,
  finalizeProjectMarkdownDocument,
  getProjectMarkdownFileSectionLength,
  MAX_TOTAL_OUTPUT_CHARS,
} from '../../shared/utils/project-markdown-policy'

type ProjectApi = {
  openDirectory: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
  saveSettings: ReturnType<typeof vi.fn>
  walkDirectory: ReturnType<typeof vi.fn>
  readFileContent: ReturnType<typeof vi.fn>
  generateProjectMarkdown: ReturnType<typeof vi.fn>
  copyToClipboard: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
  selectOutputFile: ReturnType<typeof vi.fn>
  abortOperation: ReturnType<typeof vi.fn>
  onProjectMarkdownProgress: ReturnType<typeof vi.fn>
}

let api: ProjectApi
let progressHandler: ((payload: { operationId: string; processed: number; total: number }) => void) | null

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function chooseFolder(buttonName = 'Choose project folder') {
  fireEvent.click(screen.getByRole('button', { name: buttonName }))
}

async function waitForPreview(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy())
}

function expectedDocumentChars(
  rootPath: string,
  files: { relativePath: string; size: number; content: string }[],
  includeTree = true,
): number {
  const projectName = rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Project'
  const plan = createProjectMarkdownDocumentPlan(projectName, rootPath, files, includeTree)
  const included = files.map((file) => ({
    ...file,
    sectionChars: getProjectMarkdownFileSectionLength(file.relativePath, file.content),
  }))
  return finalizeProjectMarkdownDocument(plan, included, [], 1024).stats.documentChars ?? 0
}

beforeEach(() => {
  progressHandler = null
  api = {
    openDirectory: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({
      maxFileSizeKB: 1024,
      includeTree: true,
      respectGitignore: true,
    }),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    walkDirectory: vi.fn().mockResolvedValue([]),
    readFileContent: vi.fn().mockResolvedValue(''),
    generateProjectMarkdown: vi.fn().mockResolvedValue({
      markdown: '# Generated',
      stats: { fileCount: 1, skippedCount: 0, limitedCount: 0, errorCount: 0, totalChars: 10, truncated: false, issues: [] },
    }),
    copyToClipboard: vi.fn().mockResolvedValue({ success: true }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    selectOutputFile: vi.fn().mockResolvedValue('output.md'),
    abortOperation: vi.fn().mockResolvedValue({ success: true }),
    onProjectMarkdownProgress: vi.fn((callback) => {
      progressHandler = callback
      return () => undefined
    }),
  }
  Object.defineProperty(window, 'api', { configurable: true, value: api })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Project to Markdown preview', () => {
  it('loads the preview for the first selected folder and calculates its statistics', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([{ relativePath: 'src/a.ts', size: 10 }])
    api.readFileContent.mockResolvedValue('alpha')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()

    await waitForPreview('src/a.ts')

    expect(api.walkDirectory).toHaveBeenCalledWith('/projects/A', { respectGitignore: true })
    expect(api.readFileContent).toHaveBeenCalledWith('/projects/A/src/a.ts')
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText(/1 included/).textContent).toContain(`${expectedDocumentChars('/projects/A', [{ relativePath: 'src/a.ts', size: 10, content: 'alpha' }])} document chars`)
  })

  it('excludes known oversized paths from Preview tree reservation and keeps eligible files', async () => {
    const oversizedPath = 'deep/'.repeat(1_000) + 'oversized.bin'
    api.getSettings.mockResolvedValue({ maxFileSizeKB: 1, includeTree: true, respectGitignore: true })
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue({
      rootPath: '/projects/A',
      files: [
        { relativePath: oversizedPath, size: 2_048 },
        { relativePath: 'src/kept.ts', size: 900 },
      ],
      issues: [],
    })
    api.readFileContent.mockResolvedValue('x'.repeat(900))

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('src/kept.ts')

    await waitFor(() => {
      const summary = screen.getByText(/1 included/)
      expect(summary.textContent).toContain('1 limited')
      const eligible = [{ relativePath: 'src/kept.ts', size: 900, content: 'x'.repeat(900) }]
      const plan = createProjectMarkdownDocumentPlan('A', '/projects/A', eligible, true)
      const expected = finalizeProjectMarkdownDocument(
        plan,
        eligible.map((file) => ({
          ...file,
          sectionChars: getProjectMarkdownFileSectionLength(file.relativePath, file.content),
        })),
        [{ relativePath: oversizedPath, reason: 'max-file-size', kind: 'file' }],
        1,
      ).stats.documentChars
      expect(summary.textContent).toContain(`${expected?.toLocaleString()} document chars`)
    })
    expect(api.readFileContent).toHaveBeenCalledTimes(1)
    expect(api.readFileContent).toHaveBeenCalledWith('/projects/A/src/kept.ts')
    expect(api.readFileContent).not.toHaveBeenCalledWith(`/projects/A/${oversizedPath}`)
  })

  it('recalculates the full-document preview when the tree option changes', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([{ relativePath: 'src/a.ts', size: 10 }])
    api.readFileContent.mockResolvedValue('alpha')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('src/a.ts')
    expect(screen.getByText(/1 included/).textContent).toContain(
      `${expectedDocumentChars('/projects/A', [{ relativePath: 'src/a.ts', size: 10, content: 'alpha' }], true)} document chars`,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include file tree' }))
    await waitFor(() => {
      expect(screen.getByText(/1 included/).textContent).toContain(
        `${expectedDocumentChars('/projects/A', [{ relativePath: 'src/a.ts', size: 10, content: 'alpha' }], false)} document chars`,
      )
    })
    expect(api.walkDirectory).toHaveBeenCalledTimes(2)
  })

  it('uses the shared rendered-output budget and stops reading after the cutoff', async () => {
    const candidates = [
      { relativePath: 'a-first.ts', size: 0 },
      { relativePath: 'b-cutoff.ts', size: 2000 },
      { relativePath: 'c-too-large.ts', size: 6_200_000 },
      { relativePath: 'd-after-cutoff.ts', size: 10 },
    ]
    const plan = createProjectMarkdownDocumentPlan('A', '/projects/A', candidates, true)
    const firstContentLength = plan.fileSectionBudget - getProjectMarkdownFileSectionLength('a-first.ts', '') - 1500
    api.getSettings.mockResolvedValue({ maxFileSizeKB: 6000, includeTree: true, respectGitignore: true })
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue({
      files: [
        { relativePath: 'a-first.ts', size: firstContentLength },
        { relativePath: 'b-cutoff.ts', size: 2000 },
        { relativePath: 'c-too-large.ts', size: 6_200_000 },
        { relativePath: 'd-after-cutoff.ts', size: 10 },
      ],
      issues: [],
    })
    api.readFileContent.mockImplementation((filePath: string) =>
      Promise.resolve(filePath.endsWith('a-first.ts') ? 'x'.repeat(firstContentLength) : 'y'.repeat(2000)),
    )

    render(<ProjectToMarkdownPage />)
    await waitFor(() => expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('6000'))
    await chooseFolder()
    await waitFor(() => expect(screen.getByText(/document limit applied/)).toBeTruthy())

    expect(screen.getByText(/1 included/).textContent).toContain('3 limited')
    expect(screen.getByText('Total Markdown document limit (2)')).toBeTruthy()
    expect(screen.getByText('Over per-file size limit (1)')).toBeTruthy()
    expect(screen.getAllByText('b-cutoff.ts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('c-too-large.ts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('d-after-cutoff.ts').length).toBeGreaterThan(0)
    expect(api.readFileContent).toHaveBeenCalledTimes(2)
    expect(api.readFileContent).toHaveBeenNthCalledWith(1, '/projects/A/a-first.ts')
    expect(api.readFileContent).toHaveBeenNthCalledWith(2, '/projects/A/b-cutoff.ts')
  })

  it('shows read failures in preview without discarding readable files', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue({
      files: [
        { relativePath: 'good.ts', size: 10 },
        { relativePath: 'unreadable.ts', size: 20 },
      ],
      issues: [],
    })
    api.readFileContent.mockImplementation((filePath: string) =>
      filePath.endsWith('unreadable.ts') ? Promise.reject(new Error('EACCES')) : Promise.resolve('good'),
    )

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitFor(() => expect(screen.getByText('Read errors (1)')).toBeTruthy())
    expect(screen.getByText(/1 included/).textContent).toContain('0 skipped')
    expect(screen.getByText(/1 included/).textContent).toContain('1 errors')
    expect(screen.getAllByText('unreadable.ts').length).toBeGreaterThan(0)
    expect(screen.getByText('good.ts')).toBeTruthy()
  })

  it('shows structured exclusion reasons in preview and refreshes when .gitignore is toggled', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory
      .mockResolvedValueOnce({
        files: [{ relativePath: 'large.ts', size: 2 * 1024 * 1024 }, { relativePath: 'ok.ts', size: 10 }],
        issues: [
          { relativePath: 'node_modules', reason: 'internal-ignore', kind: 'directory' },
          { relativePath: 'ignored.ts', reason: 'gitignore', kind: 'file' },
        ],
      })
      .mockResolvedValueOnce({
        files: [{ relativePath: 'large.ts', size: 2 * 1024 * 1024 }, { relativePath: 'ok.ts', size: 10 }],
        issues: [{ relativePath: 'node_modules', reason: 'internal-ignore', kind: 'directory' }],
      })
    api.readFileContent.mockResolvedValue('ok')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitFor(() => expect(screen.getAllByText('large.ts').length).toBeGreaterThan(0))
    expect(screen.getByText(/1 included/).textContent).toContain('2 skipped')
    expect(screen.getByText(/1 included/).textContent).toContain('1 limited')
    expect(screen.getByText('Built-in exclusions (1)')).toBeTruthy()
    expect(screen.getByText('.gitignore exclusions (1)')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: /Respect .gitignore/i }))
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('.gitignore exclusions (1)')).toBeNull())
    expect(api.walkDirectory).toHaveBeenLastCalledWith('/projects/A', { respectGitignore: false })
  })

  it('replaces the previous preview and statistics when another folder is selected', async () => {
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce(['/projects/B'])
    api.walkDirectory
      .mockResolvedValueOnce([{ relativePath: 'a.ts', size: 10 }])
      .mockResolvedValueOnce([{ relativePath: 'b.ts', size: 20 }])
    api.readFileContent.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/a.ts') ? 'alpha' : 'bravo!'),
    )

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    await chooseFolder('Change folder')
    await waitForPreview('b.ts')

    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('B')).toBeTruthy()
    expect(screen.getByText(/1 included/).textContent).toContain(`${expectedDocumentChars('/projects/B', [{ relativePath: 'b.ts', size: 10, content: 'bravo!' }])} document chars`)
  })

  it('recalculates preview statistics using the current file-size option', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([
      { relativePath: 'small.ts', size: 10 },
      { relativePath: 'large.ts', size: 2048 },
    ])
    api.readFileContent.mockResolvedValue('small')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('large.ts')
    expect(screen.getByText(/2 included/)).toBeTruthy()

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText(/1 included/)).toBeTruthy())
    expect(screen.getByText(/1 included/).textContent).toContain('1 limited')
  })

  it('shows a distinct empty-folder state after a successful empty preview', async () => {
    api.openDirectory.mockResolvedValue(['/projects/Empty'])
    api.walkDirectory.mockResolvedValue([])

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('This folder is empty.')

    expect(screen.getByText('Empty')).toBeTruthy()
    expect(screen.getByText(/0 included/)).toBeTruthy()
  })

  it('shows preview errors and does not retain the previous folder files', async () => {
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce(['/projects/B'])
    api.walkDirectory
      .mockResolvedValueOnce([{ relativePath: 'a.ts', size: 10 }])
      .mockRejectedValueOnce(new Error('Permission denied'))
    api.readFileContent.mockResolvedValue('alpha')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    await chooseFolder('Change folder')

    await waitForPreview('Permission denied')

    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('Preview could not be loaded.')).toBeTruthy()
    expect(screen.getByText(/0 included/).textContent).toContain('0 document chars')
  })

  it('preserves the current selection and does not load a preview when folder selection is cancelled', async () => {
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce([])
    api.walkDirectory.mockResolvedValue([{ relativePath: 'a.ts', size: 10 }])
    api.readFileContent.mockResolvedValue('alpha')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    await chooseFolder('Change folder')

    expect(api.walkDirectory).toHaveBeenCalledTimes(1)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.queryByText('This folder is empty.')).toBeNull()
    expect(screen.queryByText('Loading preview…')).toBeNull()
  })

  it('generates Markdown using the most recently selected folder', async () => {
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce(['/projects/B'])
    api.walkDirectory
      .mockResolvedValueOnce([{ relativePath: 'a.ts', size: 10 }])
      .mockResolvedValueOnce([{ relativePath: 'b.ts', size: 10 }])
    api.readFileContent.mockResolvedValue('content')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    await chooseFolder('Change folder')
    await waitForPreview('b.ts')

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateProjectMarkdown).toHaveBeenCalledTimes(1))

    expect(api.generateProjectMarkdown).toHaveBeenCalledWith(
      '/projects/B',
      { maxFileSizeKB: 1024, includeTree: true, respectGitignore: true },
      expect.any(String),
    )
  })

  it('does not start a preview if the folder picker resolves after unmount', async () => {
    const folderPicker = deferred<string[]>()
    api.openDirectory.mockReturnValue(folderPicker.promise)

    const view = render(<ProjectToMarkdownPage />)
    await chooseFolder()
    view.unmount()

    folderPicker.resolve(['/projects/after-unmount'])
    await Promise.resolve()

    expect(api.walkDirectory).not.toHaveBeenCalled()
  })

  it('ignores a late result from an older preview request', async () => {
    const requestA = deferred<{ relativePath: string; size: number }[]>()
    const requestB = deferred<{ relativePath: string; size: number }[]>()
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce(['/projects/B'])
    api.walkDirectory
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise)
    api.readFileContent.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/b.ts') ? 'bravo' : 'alpha'),
    )

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(1))
    await chooseFolder('Change folder')
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(2))

    requestB.resolve([{ relativePath: 'b.ts', size: 10 }])
    await waitForPreview('b.ts')
    await waitFor(() => expect(screen.queryByText('Loading preview…')).toBeNull())

    requestA.resolve([{ relativePath: 'a.ts', size: 10 }])
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy())

    expect(screen.getByText('b.ts')).toBeTruthy()
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText(/1 included/).textContent).toContain(`${expectedDocumentChars('/projects/B', [{ relativePath: 'b.ts', size: 10, content: 'bravo' }])} document chars`)
    expect(screen.queryByText('Loading preview…')).toBeNull()
    expect(screen.queryByText('Preview could not be loaded.')).toBeNull()
  })

  it('ignores a late error from an older preview request', async () => {
    const requestA = deferred<{ relativePath: string; size: number }[]>()
    const requestB = deferred<{ relativePath: string; size: number }[]>()
    api.openDirectory
      .mockResolvedValueOnce(['/projects/A'])
      .mockResolvedValueOnce(['/projects/B'])
    api.walkDirectory
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise)
    api.readFileContent.mockResolvedValue('bravo')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(1))
    await chooseFolder('Change folder')
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(2))

    requestB.resolve([{ relativePath: 'b.ts', size: 10 }])
    await waitForPreview('b.ts')
    await waitFor(() => expect(screen.queryByText('Loading preview…')).toBeNull())

    requestA.reject(new Error('Stale folder failure'))
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy())

    expect(screen.getByText('b.ts')).toBeTruthy()
    expect(screen.queryByText('Stale folder failure')).toBeNull()
    expect(screen.queryByText('Preview could not be loaded.')).toBeNull()
    expect(screen.queryByText('Loading preview…')).toBeNull()
  })
})

describe('Project to Markdown export report', () => {
  it('shows generated exclusions in the result and preserves the report through Copy and Save', async () => {
    const markdown = '# A\n\n## Export report\n\n- Included files: 1\n- Skipped items: 1\n- Limited files: 1'
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue({ files: [{ relativePath: 'a.ts', size: 10 }], issues: [] })
    api.readFileContent.mockResolvedValue('content')
    api.generateProjectMarkdown.mockResolvedValue({
      markdown,
      stats: {
        fileCount: 1,
        skippedCount: 1,
        limitedCount: 1,
        errorCount: 0,
        totalChars: 7,
        truncated: true,
        issues: [
          { relativePath: 'ignored.ts', reason: 'gitignore', kind: 'file' },
          { relativePath: 'large.ts', reason: 'output-limit', kind: 'file' },
        ],
      },
    })

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(markdown))
    expect(screen.getByText(/Generated 1 file\(s\), 1 skipped, 1 limited/)).toBeTruthy()
    expect(screen.getByText('2 skipped or limited item(s) — reasons and paths')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith(markdown))
    fireEvent.click(screen.getByRole('button', { name: 'Save to .md' }))
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledWith('output.md', markdown))
  })

  it('replaces stale preview candidates with the exact scan used by Generate', async () => {
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue({ files: [{ relativePath: 'old.txt', size: 3 }], issues: [] })
    api.readFileContent.mockResolvedValue('old')
    api.generateProjectMarkdown.mockResolvedValue({
      markdown: '# Generated with current ignore rules',
      scannedFiles: [{ relativePath: 'current.txt', size: 7 }],
      stats: {
        fileCount: 1,
        skippedCount: 1,
        limitedCount: 0,
        errorCount: 0,
        totalChars: getProjectMarkdownFileSectionLength('current.txt', 'current'),
        truncated: false,
        issues: [{ relativePath: 'old.txt', reason: 'gitignore', kind: 'file' }],
      },
    })

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('old.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(screen.getByText('current.txt')).toBeTruthy())
    expect(screen.queryByText('old.txt')).toBeTruthy() // remains in the reason/path report, not as a candidate row
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated with current ignore rules')
  })

  it('keeps progress operation-scoped, supports cancellation, and permits a subsequent export', async () => {
    const pending = deferred<{
      markdown: string
      stats: { fileCount: number; skippedCount: number; limitedCount: number; errorCount: number; totalChars: number; truncated: boolean; issues: [] }
    }>()
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([{ relativePath: 'a.ts', size: 10 }])
    api.readFileContent.mockResolvedValue('content')
    api.generateProjectMarkdown
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({
        markdown: '# Second export',
        stats: { fileCount: 1, skippedCount: 0, limitedCount: 0, errorCount: 0, totalChars: 13, truncated: false, issues: [] },
      })

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateProjectMarkdown).toHaveBeenCalledTimes(1))
    const operationId = api.generateProjectMarkdown.mock.calls[0][2]
    act(() => progressHandler?.({ operationId, processed: 1, total: 1 }))
    expect(screen.getByText('Processing 1 of 1 files…')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.abortOperation).toHaveBeenCalledWith(operationId))
    await act(async () => pending.reject(new Error('Operation aborted')))
    await waitFor(() => expect(screen.getByText('Generation aborted.')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Second export'))
    expect(api.generateProjectMarkdown).toHaveBeenCalledTimes(2)
  })
})

describe('Project to Markdown settings', () => {
  it('initializes all options from saved settings', async () => {
    api.getSettings.mockResolvedValue({
      maxFileSizeKB: 256,
      includeTree: false,
      respectGitignore: false,
    })

    render(<ProjectToMarkdownPage />)

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('256')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(false)
      expect(checkboxes[1].checked).toBe(false)
    })
    expect(api.getSettings).toHaveBeenCalledTimes(1)
  })

  it('uses defaults for fields missing from the settings response', async () => {
    api.getSettings.mockResolvedValue({ maxFileSizeKB: 64 })

    render(<ProjectToMarkdownPage />)

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('64')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(true)
    })
  })

  it('replaces an invalid maxFileSizeKB with its default', async () => {
    api.getSettings.mockResolvedValue({
      maxFileSizeKB: Number.NaN,
      includeTree: false,
      respectGitignore: false,
    })

    render(<ProjectToMarkdownPage />)

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1024')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(false)
      expect(checkboxes[1].checked).toBe(false)
    })
  })

  it('replaces invalid boolean values with their respective defaults', async () => {
    api.getSettings.mockResolvedValue({
      maxFileSizeKB: 32,
      includeTree: 'false',
      respectGitignore: 0,
    })

    render(<ProjectToMarkdownPage />)

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('32')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(true)
    })
  })

  it('normalizes each setting independently without discarding valid fields', async () => {
    api.getSettings.mockResolvedValue({
      maxFileSizeKB: 48,
      includeTree: null,
      respectGitignore: false,
    })

    render(<ProjectToMarkdownPage />)

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('48')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(false)
    })
  })

  it('keeps the page usable with defaults and a warning when settings loading fails', async () => {
    api.getSettings.mockRejectedValue(new Error('IPC unavailable'))
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([{ relativePath: 'a.ts', size: 10 }])

    render(<ProjectToMarkdownPage />)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Using default values'))
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1024')

    await chooseFolder()
    await waitForPreview('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated'))

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith('# Generated'))
    fireEvent.click(screen.getByRole('button', { name: 'Save to .md' }))
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledWith('output.md', '# Generated'))
    expect(api.saveSettings).not.toHaveBeenCalled()
  })

  it('does not overwrite options edited before the settings response resolves', async () => {
    const settingsRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    api.getSettings.mockReturnValue(settingsRequest.promise)

    render(<ProjectToMarkdownPage />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '333' } })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    settingsRequest.resolve({
      maxFileSizeKB: 2048,
      includeTree: true,
      respectGitignore: false,
    })

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('333')
      const currentCheckboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(currentCheckboxes[0].checked).toBe(false)
      expect(currentCheckboxes[1].checked).toBe(false)
    })
  })

  it('ignores a settings response that settles after the component unmounts', async () => {
    const settingsRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    api.getSettings.mockReturnValue(settingsRequest.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = render(<ProjectToMarkdownPage />)
    view.unmount()
    settingsRequest.resolve({
      maxFileSizeKB: 12,
      includeTree: false,
      respectGitignore: false,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(consoleError).not.toHaveBeenCalled()
    expect(api.saveSettings).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('reloads preview statistics when saved maxFileSizeKB arrives after folder preview', async () => {
    const settingsRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    api.getSettings.mockReturnValue(settingsRequest.promise)
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory.mockResolvedValue([
      { relativePath: 'small.ts', size: 10 },
      { relativePath: 'large.ts', size: 2048 },
    ])
    api.readFileContent.mockResolvedValue('content')

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('large.ts')
    expect(screen.getByText(/2 included/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated'),
    )

    settingsRequest.resolve({
      maxFileSizeKB: 1,
      includeTree: true,
      respectGitignore: true,
    })

    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByText(/1 included/)).toBeTruthy()
      expect(screen.getByText(/1 included/).textContent).toContain('1 limited')
    })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated')
  })

  it('preserves generated Markdown when the file-size limit changes during a settings-triggered preview reload', async () => {
    const settingsRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    const settingsPreview = deferred<{ relativePath: string; size: number }[]>()
    const updatedPreview = deferred<{ relativePath: string; size: number }[]>()
    const listedFiles = [
      { relativePath: 'small.ts', size: 10 },
      { relativePath: 'large.ts', size: 2048 },
    ]

    api.getSettings.mockReturnValue(settingsRequest.promise)
    api.openDirectory.mockResolvedValue(['/projects/A'])
    api.walkDirectory
      .mockResolvedValueOnce(listedFiles)
      .mockReturnValueOnce(settingsPreview.promise)
      .mockReturnValueOnce(updatedPreview.promise)
    api.readFileContent.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/large.ts') ? 'large-content' : 'small-content'),
    )

    render(<ProjectToMarkdownPage />)
    await chooseFolder()
    await waitForPreview('large.ts')

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated'),
    )
    expect(api.generateProjectMarkdown).toHaveBeenCalledTimes(1)

    await act(async () => {
      settingsRequest.resolve({
        maxFileSizeKB: 1,
        includeTree: true,
        respectGitignore: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status').textContent).toContain('Loading preview')

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    await waitFor(() => expect(api.walkDirectory).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('status').textContent).toContain('Loading preview')

    await act(async () => {
      updatedPreview.resolve(listedFiles)
      await updatedPreview.promise
    })

    await waitFor(() => {
      expect(screen.getByText(/2 included/)).toBeTruthy()
      expect(screen.getByText(/2 included/).textContent).toContain('0 skipped')
      expect(screen.getByText(/2 included/).textContent).toContain(`${expectedDocumentChars('/projects/A', [{ relativePath: 'small.ts', size: 10, content: 'small-content' }, { relativePath: 'large.ts', size: 10, content: 'large-content' }])} document chars`)
    })

    await act(async () => {
      settingsPreview.resolve(listedFiles)
      await settingsPreview.promise
    })

    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('3')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Generated')
    expect(api.generateProjectMarkdown).toHaveBeenCalledTimes(1)
    expect(api.walkDirectory).toHaveBeenCalledTimes(3)
  })

  it('ignores the superseded settings request when effects are replayed in StrictMode', async () => {
    const firstRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    const secondRequest = deferred<{
      maxFileSizeKB: number
      includeTree: boolean
      respectGitignore: boolean
    }>()
    api.getSettings.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise)

    render(
      <StrictMode>
        <ProjectToMarkdownPage />
      </StrictMode>,
    )

    expect(api.getSettings).toHaveBeenCalledTimes(2)

    firstRequest.resolve({
      maxFileSizeKB: 10,
      includeTree: false,
      respectGitignore: false,
    })
    secondRequest.resolve({
      maxFileSizeKB: 20,
      includeTree: true,
      respectGitignore: false,
    })

    await waitFor(() => {
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('20')
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(false)
    })
  })

  it('does not automatically save option changes', async () => {
    render(<ProjectToMarkdownPage />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '128' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    expect(api.saveSettings).not.toHaveBeenCalled()
  })
})
