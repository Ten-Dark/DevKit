// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import XMindToMarkdownPage from './xmind-to-markdown'

const result = {
  markdown: '# Root\n  - Child\n',
  title: 'Root',
  topicCount: 1,
  depth: 1,
  sheetsCount: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let progressCallback: ((payload: { operationId: string; phase: 'extracting' | 'converting'; stage?: 'sheets' | 'parsing' | 'rendering'; processed: number; total: number; processedEntries: number; totalEntries: number }) => void) | undefined
let api: {
  selectXMindFile: ReturnType<typeof vi.fn>
  convertXMindToMarkdown: ReturnType<typeof vi.fn>
  cancelXMindConversion: ReturnType<typeof vi.fn>
  onXMindConversionProgress: ReturnType<typeof vi.fn>
  copyToClipboard: ReturnType<typeof vi.fn>
  selectXMindOutputFile: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  progressCallback = undefined
  api = {
    selectXMindFile: vi.fn().mockResolvedValue('C:\\maps\\demo.xmind'),
    convertXMindToMarkdown: vi.fn(),
    cancelXMindConversion: vi.fn().mockResolvedValue({ success: true }),
    onXMindConversionProgress: vi.fn((callback) => {
      progressCallback = callback
      return vi.fn()
    }),
    copyToClipboard: vi.fn().mockResolvedValue({ success: true }),
    selectXMindOutputFile: vi.fn().mockResolvedValue('C:\\maps\\demo.md'),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
  }
  Object.defineProperty(window, 'api', { configurable: true, value: api })
})

afterEach(() => cleanup())

async function chooseFile() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose .xmind file' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Convert' }).hasAttribute('disabled')).toBe(false))
}

describe('XMind conversion progress and cancellation', () => {
  it('provides a flexible full-workspace Markdown preview layout', () => {
    render(<XMindToMarkdownPage />)
    expect(document.querySelector('.xmind-page')).toBeTruthy()
    expect(document.querySelector('.xmind-layout')).toBeTruthy()
    expect(document.querySelector('.xmind-workspace')).toBeTruthy()
    expect(document.querySelector('.xmind-output-card')).toBeTruthy()
    expect(document.querySelector('.xmind-preview .xmind-output-text')).toBeTruthy()
  })

  it('starts conversion, displays progress updates, and renders successful output', async () => {
    const pending = deferred<typeof result>()
    api.convertXMindToMarkdown.mockReturnValue(pending.promise)
    render(<XMindToMarkdownPage />)
    await chooseFile()

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledOnce())
    const operationId = api.convertXMindToMarkdown.mock.calls[0][1]

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose .xmind file' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Copy to clipboard' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Save to .md' }).hasAttribute('disabled')).toBe(true)

    act(() => progressCallback?.({ operationId, phase: 'extracting', processed: 2048, total: 5120, processedEntries: 0, totalEntries: 5 }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2048')
    expect(screen.getByRole('status').textContent).toContain('Extracting archive: 2.0 KB of 5.0 KB')

    act(() => progressCallback?.({ operationId, phase: 'converting', stage: 'parsing', processed: 128, total: 0, processedEntries: 0, totalEntries: 0 }))
    expect(screen.getByRole('status').textContent).toContain('Parsing topics: 128 processed')

    act(() => progressCallback?.({ operationId, phase: 'converting', stage: 'rendering', processed: 1, total: 2, processedEntries: 0, totalEntries: 0 }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
    expect(screen.getByRole('status').textContent).toContain('Rendering Markdown: 1 of 2')

    await act(async () => pending.resolve(result))
    expect((screen.getByRole('textbox', { name: 'Generated Markdown' }) as HTMLTextAreaElement).value).toBe(result.markdown)
    expect(screen.getByText('Converted 1 topic(s), depth 1.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Convert' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('requests cancellation and returns to an idle state that allows another run', async () => {
    const pending = deferred<typeof result>()
    const cancelPending = deferred<{ success: boolean }>()
    api.cancelXMindConversion.mockReturnValueOnce(cancelPending.promise)
    api.convertXMindToMarkdown.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result)
    render(<XMindToMarkdownPage />)
    await chooseFile()

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledOnce())
    const operationId = api.convertXMindToMarkdown.mock.calls[0][1]

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.cancelXMindConversion).toHaveBeenCalledWith(operationId))
    expect(screen.getByRole('button', { name: 'Cancelling...' })).toBeTruthy()
    await act(async () => cancelPending.resolve({ success: true }))
    expect(screen.getByRole('button', { name: 'Cancelling...' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()

    await act(async () => pending.reject(new Error('Operation aborted')))
    expect(screen.getByText('Conversion cancelled.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Convert' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Generated Markdown' })).toHaveProperty('value', result.markdown))
  })

  it('restores the cancel action when the cancellation request is rejected', async () => {
    const pending = deferred<typeof result>()
    api.convertXMindToMarkdown.mockReturnValue(pending.promise)
    api.cancelXMindConversion.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
    render(<XMindToMarkdownPage />)
    await chooseFile()

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledOnce())
    const operationId = api.convertXMindToMarkdown.mock.calls[0][1]

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cancellation could not be confirmed. The conversion may still be running.')
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.cancelXMindConversion).toHaveBeenCalledTimes(2))
    expect(api.cancelXMindConversion).toHaveBeenLastCalledWith(operationId)
    expect(screen.getByRole('button', { name: 'Cancelling...' }).hasAttribute('disabled')).toBe(true)

    await act(async () => pending.reject(new Error('Operation aborted')))
    expect(screen.getByText('Conversion cancelled.')).toBeTruthy()
  })

  it('shows conversion errors and permits retry', async () => {
    api.convertXMindToMarkdown.mockRejectedValueOnce(new Error('Invalid XMind archive')).mockResolvedValueOnce(result)
    render(<XMindToMarkdownPage />)
    await chooseFile()

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid XMind archive')
    expect(screen.getByRole('button', { name: 'Convert' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Generated Markdown' }) as HTMLTextAreaElement).value).toBe(result.markdown))
  })

  it('ignores progress events belonging to a previous operation', async () => {
    const first = deferred<typeof result>()
    const second = deferred<typeof result>()
    api.convertXMindToMarkdown.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<XMindToMarkdownPage />)
    await chooseFile()

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledTimes(1))
    const firstId = api.convertXMindToMarkdown.mock.calls[0][1]
    await act(async () => first.resolve(result))

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledTimes(2))
    const secondId = api.convertXMindToMarkdown.mock.calls[1][1]
    act(() => progressCallback?.({ operationId: secondId, phase: 'extracting', processed: 1, total: 4, processedEntries: 0, totalEntries: 4 }))
    act(() => progressCallback?.({ operationId: firstId, phase: 'extracting', processed: 4, total: 4, processedEntries: 4, totalEntries: 4 }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')

    await act(async () => second.resolve(result))
  })

  it('requests cancellation when the page unmounts during a conversion', async () => {
    const pending = deferred<typeof result>()
    api.convertXMindToMarkdown.mockReturnValue(pending.promise)
    const view = render(<XMindToMarkdownPage />)
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(api.convertXMindToMarkdown).toHaveBeenCalledOnce())
    const operationId = api.convertXMindToMarkdown.mock.calls[0][1]

    const unsubscribe = api.onXMindConversionProgress.mock.results[0].value
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(api.cancelXMindConversion).toHaveBeenCalledWith(operationId)
  })
})
