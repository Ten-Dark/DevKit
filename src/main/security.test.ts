import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
}))

import {
  addAllowedBaseDir,
  addAllowedOutputPath,
  isPathAllowed,
  isUnderBase,
  resolveRealPathUnderBase,
} from './security.js'

describe('security', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('isUnderBase', () => {
    it('returns true for path under base', () => {
      expect(isUnderBase('/base/dir/file.txt', '/base/dir')).toBe(true)
    })

    it('returns false for path outside base', () => {
      expect(isUnderBase('/other/file.txt', '/base/dir')).toBe(false)
    })

    it('returns false for path traversal with ..', () => {
      expect(isUnderBase('/base/dir/../outside.txt', '/base/dir')).toBe(false)
    })

    it('returns false for same path (relative is empty)', () => {
      expect(isUnderBase('/base/dir', '/base/dir')).toBe(false)
    })
  })

  describe('isPathAllowed', () => {
    beforeEach(() => {
      // Reset modules to clear allowedBaseDirs
      vi.resetModules()
    })

    it('allows paths under registered base dir', async () => {
      const { isPathAllowed: ipa, addAllowedBaseDir: abd } = await import('./security.js')
      abd('/allowed/base')
      expect(ipa('/allowed/base/file.txt')).toBe(true)
    })

    it('denies paths outside registered base dir', async () => {
      const { isPathAllowed: ipa, addAllowedBaseDir: abd } = await import('./security.js')
      abd('/allowed/base')
      expect(ipa('/etc/passwd')).toBe(false)
    })

    it('allows output paths directly', async () => {
      const { isPathAllowed: ipa, addAllowedOutputPath: aop } = await import('./security.js')
      aop('/tmp/output.md')
      expect(ipa('/tmp/output.md')).toBe(true)
    })
  })

  describe('resolveRealPathUnderBase', () => {
    it('resolves and validates a real path under base', async () => {
      const realFile = path.join(tmpDir, 'file.txt')
      await fs.writeFile(realFile, 'test')
      addAllowedBaseDir(tmpDir)
      const real = await resolveRealPathUnderBase(realFile)
      expect(real).toBe(path.resolve(realFile))
    })

    it('throws for path outside base', async () => {
      const outsideFile = path.join(os.tmpdir(), 'outside-test-file.txt')
      await fs.writeFile(outsideFile, 'test')
      addAllowedBaseDir(tmpDir)
      await expect(resolveRealPathUnderBase(outsideFile)).rejects.toThrow(
        /Access denied/,
      )
      await fs.rm(outsideFile, { force: true }).catch(() => {})
    })

    it('throws for non-existent path', async () => {
      addAllowedBaseDir(tmpDir)
      await expect(
        resolveRealPathUnderBase(path.join(tmpDir, 'nonexistent.txt')),
      ).rejects.toThrow(/does not exist/)
    })

    it('allows output paths', async () => {
      const outputFile = path.join(tmpDir, 'output.md')
      await fs.writeFile(outputFile, 'test')
      addAllowedOutputPath(outputFile)
      const real = await resolveRealPathUnderBase(outputFile)
      expect(real).toBe(path.resolve(outputFile))
    })
  })
})
