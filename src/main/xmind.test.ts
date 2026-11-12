import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import { ipcMain } from 'electron'
import { resetIpcRegistry } from './ipc-registry.js'

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

import { registerXMindHandlers } from './xmind.js'

const handled = new Map<string, Function>()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Fixtures are pre-built valid .xmind ZIP archives in scripts/__xmind_fixtures__
const FIXTURES_DIR = path.resolve(__dirname, '../../scripts/__xmind_fixtures__')

beforeEach(() => {
  handled.clear()
  resetIpcRegistry()
  vi.mocked(ipcMain.handle).mockImplementation(
    (channel: string, handler: Function) => {
      handled.set(channel, handler)
    },
  )
  registerXMindHandlers()
})

afterEach(() => {
  vi.clearAllMocks()
})

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handled.get(channel)
  if (!handler) throw new Error(`No handler for channel: ${channel}`)
  const event = { sender: { send: vi.fn() } }
  return handler(event as any, ...args)
}

describe('xmind main process', () => {
  describe('C6 — deep nesting does not stack overflow', () => {
    it('converts deeply nested XMind (500 levels)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'deep.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.topicCount).toBe(500)
      expect(result.depth).toBe(500)
      expect(result.markdown).toContain('Level 0')
    })
  })

  describe('C7 — notes rendering', () => {
    it('preserves multi-line notes with blockquote prefix on each line', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'special.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.markdown).toContain('\\# This looks like a heading')
      const lines = result.markdown.split('\n')
      const blockquoteLines = lines.filter((l: string) =>
        l.trimStart().startsWith('> '),
      )
      expect(blockquoteLines.length).toBeGreaterThanOrEqual(3)
    })

    it('does not turn note text starting with # into a heading', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'special.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      const headingLines = result.markdown
        .split('\n')
        .filter((l: string) => /^# /.test(l))
      expect(headingLines.length).toBe(1)
      expect(headingLines[0]).toBe('# Root')
    })
  })

  describe('C8 — hyperlinks with special characters', () => {
    it('escapes ) in URL', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'special.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.markdown).toContain('\\)')
    })

    it('escapes # in topic title to prevent heading', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'special.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.markdown).toContain('Topic with \\# heading')
    })
  })

  describe('P7 — content.json preference', () => {
    it('prefers content.json in archive root', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'single.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Root Topic')
      expect(result.markdown).toContain('Child 1')
    })

    it('finds content.json when rootTopic is present', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'nested.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Nested')
    })
  })

  describe('P8 — multiple sheets', () => {
    it('converts all sheets in multi-sheet XMind', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'multi.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.sheetsCount).toBe(2)
      expect(result.markdown).toContain('Child A')
      expect(result.markdown).toContain('Child B')
      expect(result.topicCount).toBe(2)
    })

    it('includes warning about multiple sheets', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'multi.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(
        result.warnings.some((w: string) => w.includes('Multiple sheets')),
      ).toBe(true)
    })
  })

  describe('P9 — ZIP extraction safety', () => {
    it('rejects corrupted ZIP', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'corrupted.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Failed to extract/)
    })

    it('rejects archive without rootTopic', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'nocontent.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/No valid sheets found|rootTopic not found/)
    })
  })

  describe('P10 — case-insensitive extension', () => {
    it('converts .XMIND (uppercase) file', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'uppercase.XMIND')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Root Topic')
    })
  })
})
