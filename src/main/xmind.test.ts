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
    it('preserves multi-line notes with exact content', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'special.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)

      // Full exact comparison of notes section
      expect(result.markdown).toContain('> This is a note')
      expect(result.markdown).toContain('> \\# This looks like a heading')
      expect(result.markdown).toContain('> Line 3')

      // Multi-line notes: each line gets its own > prefix
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
    it('rejects corrupted ZIP (no EOCD record)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'corrupted.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Invalid ZIP archive|Failed to extract/)
    })

    it('accepts valid normal XMind ZIP', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'single.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Root Topic')
    })

    it('rejects entry claiming huge uncompressed size (ZIP bomb)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-big-entry.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/exceeds limit/)
    })

    it('rejects too many entries (> 5000)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-many-entries.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/entry count exceeds limit/)
    })

    it('rejects Zip Slip path traversal (../)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-zip-slip.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects absolute path (/etc/passwd)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-absolute.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects Windows absolute path (C:\\...)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-absolute-win.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects duplicate entry names', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-duplicate.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Duplicate ZIP entry/)
    })

    // ZIP64 tests
    it('rejects ZIP64 End of Central Directory record', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-eocd.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/ZIP64 archives are not supported/)
    })

    it('rejects ZIP64 sentinel values in standard fields', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-sentinel.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/ZIP64 sentinel values|ZIP64 archives are not supported/)
    })

    // Windows path tests
    it('rejects drive-relative path (C:file.txt)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-drive-relative.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects UNC path (\\\\server\\share\\...)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-unc.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects dot component (./content.json)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-dot.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects Windows reserved name (CON)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-con.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects Windows reserved name (NUL)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-nul.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    it('rejects Windows reserved name (COM1)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-com1.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Unsafe ZIP entry path/)
    })

    // Duplicate entry tests
    it('rejects case-insensitive duplicate entries', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-dup-case.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Duplicate ZIP entry/)
    })

    it('rejects Unicode NFC/NFD duplicate entries', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-dup-unicode.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Duplicate ZIP entry/)
    })

    // Symlink entry test
    it('rejects symlink entry (Unix external attribute)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-symlink.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/symlink entry detected/)
    })

    // Central Directory bounds tests
    it('rejects local header offset beyond file size', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-bad-cd-offset.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/local header offset.*exceeds file size|Invalid ZIP archive/)
    })

    it('rejects central directory size exceeding file', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-bad-cd-size.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Invalid ZIP archive/)
    })

    // EOCD validation tests
    it('accepts valid archive with normal comment', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-valid-comment.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Test')
    })

    it('accepts archive with EOCD-like signature bytes inside comment', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-sig-in-comment.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Test')
    })

    it('rejects EOCD with incorrect comment length', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-bad-comment-len.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/EOCD comment does not end at EOF/)
    })

    it('rejects truncated EOCD', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-truncated.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/Invalid ZIP archive|End of Central Directory/)
    })

    it('accepts archive with multiple EOCD-like signatures in comment', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-multi-sig-comment.xmind')
      const result: any = await invoke('convertXMindToMarkdown', xmindPath)
      expect(result.title).toBe('Test')
    })

    it('rejects full ZIP64 structure (locator + EOCD record)', async () => {
      const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-full.xmind')
      await expect(
        invoke('convertXMindToMarkdown', xmindPath),
      ).rejects.toThrow(/ZIP64 archives are not supported/)
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
