import { safeStorage } from 'electron'

const MAX_ENCRYPTED_PAYLOAD_LENGTH = 2 * 1024 * 1024

/**
 * OS-backed encryption adapter for small credential payloads.
 * This is not the product Vault: it has no independent unlock, key hierarchy,
 * backup, recovery, or cross-device migration model.
 */
export class OsSecretStore {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length > MAX_ENCRYPTED_PAYLOAD_LENGTH) {
      throw new Error('Secret payload is invalid or exceeds the supported size.')
    }
    if (!this.isAvailable()) {
      throw new Error('OS-backed encryption is unavailable. Credentials cannot be saved safely on this device.')
    }
    return safeStorage.encryptString(plaintext).toString('base64')
  }

  decrypt(encodedPayload: string): string {
    if (typeof encodedPayload !== 'string' || encodedPayload.length === 0
      || encodedPayload.length > MAX_ENCRYPTED_PAYLOAD_LENGTH * 2
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedPayload)) {
      throw new Error('Encrypted secret payload is invalid.')
    }
    if (!this.isAvailable()) {
      throw new Error('OS-backed encryption is unavailable. Stored credentials cannot be decrypted.')
    }
    return safeStorage.decryptString(Buffer.from(encodedPayload, 'base64'))
  }
}
