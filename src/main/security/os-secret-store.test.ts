import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

import { OsSecretStore } from './os-secret-store.js'

describe('OsSecretStore', () => {
  let store: OsSecretStore

  beforeEach(() => {
    store = new OsSecretStore()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from('encrypted:' + value))
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString().replace('encrypted:', ''))
  })

  it('encrypts and decrypts through Electron safeStorage', () => {
    const encrypted = store.encrypt('credential payload')
    expect(encrypted).toBe(Buffer.from('encrypted:credential payload').toString('base64'))
    expect(store.decrypt(encrypted)).toBe('credential payload')
  })

  it('fails closed when OS encryption is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(() => store.encrypt('secret')).toThrow(/cannot be saved safely/)
    expect(() => store.decrypt(Buffer.from('encrypted').toString('base64'))).toThrow(/cannot be decrypted/)
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('rejects invalid and oversized payloads', () => {
    expect(() => store.encrypt('x'.repeat(2 * 1024 * 1024 + 1))).toThrow(/exceeds/)
    expect(() => store.decrypt('not-base64!')).toThrow(/invalid/)
    expect(() => store.decrypt('')).toThrow(/invalid/)
  })
})
