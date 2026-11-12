const fs = require('fs')
const path = require('path')

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const fixturesDir = path.join('scripts', '__xmind_fixtures__')

function buildZip(entries, options = {}) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content, uncompressedSizeOverride, externalAttr } of entries) {
    const contentBuf =
      Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const crcVal = crc32(contentBuf)
    const actualUncompressedSize = uncompressedSizeOverride ?? contentBuf.length

    const lfh = Buffer.alloc(30 + nameBuf.length)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(0, 6)
    lfh.writeUInt16LE(0, 8)
    lfh.writeUInt32LE(0, 10)
    lfh.writeUInt32LE(crcVal, 14)
    lfh.writeUInt32LE(contentBuf.length, 18)
    lfh.writeUInt32LE(contentBuf.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)
    nameBuf.copy(lfh, 30)

    localHeaders = Buffer.concat([localHeaders, lfh, contentBuf])

    const cde = Buffer.alloc(46 + nameBuf.length)
    cde.writeUInt32LE(0x02014b50, 0)
    cde.writeUInt16LE(options.versionMadeBy ?? 20, 4)
    cde.writeUInt16LE(options.versionNeeded ?? 20, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(crcVal, 16)
    cde.writeUInt32LE(0, 20)
    cde.writeUInt32LE(actualUncompressedSize, 24)
    cde.writeUInt16LE(nameBuf.length, 28)
    cde.writeUInt16LE(0, 30)
    cde.writeUInt16LE(0, 32)
    cde.writeUInt16LE(0, 34)
    cde.writeUInt16LE(0, 36)
    cde.writeUInt32LE(externalAttr ?? 0, 38)
    cde.writeUInt32LE(offset, 42)
    nameBuf.copy(cde, 46)

    centralDir = Buffer.concat([centralDir, cde])
    offset += lfh.length + contentBuf.length
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localHeaders, centralDir, eocd])
}

// 1. ZIP64 EOCD signature (0x06064b50)
function buildZip64EOCD(entries) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content } of entries) {
    const contentBuf = Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const lfh = Buffer.alloc(30 + nameBuf.length)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(45, 4)
    lfh.writeUInt16LE(0, 6)
    lfh.writeUInt16LE(0, 8)
    lfh.writeUInt32LE(0, 10)
    lfh.writeUInt32LE(0, 14)
    lfh.writeUInt32LE(contentBuf.length, 18)
    lfh.writeUInt32LE(contentBuf.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)
    nameBuf.copy(lfh, 30)
    localHeaders = Buffer.concat([localHeaders, lfh, contentBuf])

    const cde = Buffer.alloc(46 + nameBuf.length)
    cde.writeUInt32LE(0x02014b50, 0)
    cde.writeUInt16LE(45, 4)
    cde.writeUInt16LE(45, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(0, 16)
    cde.writeUInt32LE(0, 20)
    cde.writeUInt32LE(contentBuf.length, 24)
    cde.writeUInt16LE(nameBuf.length, 28)
    cde.writeUInt16LE(0, 30)
    cde.writeUInt16LE(0, 32)
    cde.writeUInt16LE(0, 34)
    cde.writeUInt16LE(0, 36)
    cde.writeUInt32LE(0, 38)
    cde.writeUInt32LE(offset, 42)
    nameBuf.copy(cde, 46)
    centralDir = Buffer.concat([centralDir, cde])
    offset += lfh.length + contentBuf.length
  }

  // ZIP64 End of Central Directory Record (56 bytes + variable)
  const zip64EOCDSize = 56
  const zip64EOCD = Buffer.alloc(zip64EOCDSize)
  zip64EOCD.writeUInt32LE(0x06064b50, 0) // signature
  zip64EOCD.writeBigUInt64LE(BigInt(zip64EOCDSize - 12), 4) // size of zip64 eocd
  zip64EOCD.writeUInt16LE(45, 12) // version made by
  zip64EOCD.writeUInt16LE(45, 14) // version needed
  zip64EOCD.writeUInt32LE(0, 16) // disk number
  zip64EOCD.writeUInt32LE(0, 20) // cd start disk
  zip64EOCD.writeBigUInt64LE(BigInt(entries.length), 24) // entries on this disk
  zip64EOCD.writeBigUInt64LE(BigInt(entries.length), 32) // total entries
  zip64EOCD.writeBigUInt64LE(BigInt(centralDir.length), 40) // cd size
  zip64EOCD.writeBigUInt64LE(BigInt(offset + localHeaders.length), 48) // cd offset

  // ZIP64 End of Central Directory Locator (20 bytes)
  const zip64Locator = Buffer.alloc(20)
  zip64Locator.writeUInt32LE(0x07064b50, 0) // signature
  zip64Locator.writeUInt32LE(0, 4) // cd start disk
  zip64Locator.writeBigUInt64LE(BigInt(offset + localHeaders.length + centralDir.length), 8) // zip64 eocd offset
  zip64Locator.writeUInt32LE(1, 16) // number of disks

  // Standard EOCD pointing to ZIP64 (0xFFFF sentinel values)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0xFFFF, 4) // disk number (ZIP64 sentinel)
  eocd.writeUInt16LE(0xFFFF, 6) // cd start disk
  eocd.writeUInt16LE(0xFFFF, 8) // entries on this disk
  eocd.writeUInt16LE(0xFFFF, 10) // total entries
  eocd.writeUInt32LE(0xFFFFFFFF, 12) // cd size
  eocd.writeUInt32LE(0xFFFFFFFF, 16) // cd offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localHeaders, centralDir, zip64EOCD, zip64Locator, eocd])
}

// ZIP64 fixtures
fs.writeFileSync(
  path.join(fixturesDir, 'p9-zip64-eocd.xmind'),
  buildZip64EOCD([
    { name: 'content.json', content: JSON.stringify({ rootTopic: { title: 'Zip64', children: { topics: [] } } }) },
  ])
)

// ZIP64 with sentinel values in standard EOCD (already in buildZip64EOCD)
// Also create one with just the sentinel in standard fields
fs.writeFileSync(
  path.join(fixturesDir, 'p9-zip64-sentinel.xmind'),
  buildZip([
    { name: 'content.json', content: 'x', uncompressedSizeOverride: 0xFFFFFFFF },
  ], { versionNeeded: 45 })
)

// Drive-relative path (C:file.txt)
fs.writeFileSync(
  path.join(fixturesDir, 'p9-drive-relative.xmind'),
  buildZip([{ name: 'C:file.txt', content: 'x' }])
)

// UNC path
fs.writeFileSync(
  path.join(fixturesDir, 'p9-unc.xmind'),
  buildZip([{ name: '\\\\server\\share\\file.txt', content: 'x' }])
)

// Mixed separators
fs.writeFileSync(
  path.join(fixturesDir, 'p9-mixed-sep.xmind'),
  buildZip([{ name: 'sub\\dir\\file.txt', content: 'x' }])
)

// Dot component
fs.writeFileSync(
  path.join(fixturesDir, 'p9-dot.xmind'),
  buildZip([{ name: './content.json', content: 'x' }])
)

// Windows reserved names
fs.writeFileSync(
  path.join(fixturesDir, 'p9-reserved-con.xmind'),
  buildZip([{ name: 'CON', content: 'x' }])
)

fs.writeFileSync(
  path.join(fixturesDir, 'p9-reserved-nul.xmind'),
  buildZip([{ name: 'NUL', content: 'x' }])
)

fs.writeFileSync(
  path.join(fixturesDir, 'p9-reserved-com1.xmind'),
  buildZip([{ name: 'COM1', content: 'x' }])
)

// Case-insensitive duplicates
fs.writeFileSync(
  path.join(fixturesDir, 'p9-dup-case.xmind'),
  buildZip([
    { name: 'content.json', content: 'a' },
    { name: 'Content.json', content: 'b' },
  ])
)

// Unicode NFC/NFD duplicates
// é as single codepoint (NFC) vs e + combining accent (NFD)
const nfcName = 'caf\u00e9.json' // é as U+00E9
const nfdName = 'cafe\u0301.json' // e + combining acute accent U+0301
fs.writeFileSync(
  path.join(fixturesDir, 'p9-dup-unicode.xmind'),
  buildZip([
    { name: nfcName, content: 'a' },
    { name: nfdName, content: 'b' },
  ])
)

// Symlink entry (Unix external attribute with S_IFLNK)
function buildZipWithSymlink() {
  const nameBuf = Buffer.from('link.txt', 'utf-8')
  const contentBuf = Buffer.from('/etc/passwd', 'utf-8')
  const crcVal = crc32(contentBuf)

  // Local header
  const lfh = Buffer.alloc(30 + nameBuf.length)
  lfh.writeUInt32LE(0x04034b50, 0)
  lfh.writeUInt16LE(20, 4)
  lfh.writeUInt16LE(0, 6)
  lfh.writeUInt16LE(0, 8)
  lfh.writeUInt32LE(0, 10)
  lfh.writeUInt32LE(crcVal, 14)
  lfh.writeUInt32LE(contentBuf.length, 18)
  lfh.writeUInt32LE(contentBuf.length, 22)
  lfh.writeUInt16LE(nameBuf.length, 26)
  lfh.writeUInt16LE(0, 28)
  nameBuf.copy(lfh, 30)

  // Central directory entry with symlink external attribute (S_IFLNK = 0xA000 << 16)
  const cde = Buffer.alloc(46 + nameBuf.length)
  cde.writeUInt32LE(0x02014b50, 0)
  cde.writeUInt16LE(20, 4)
  cde.writeUInt16LE(20, 6)
  cde.writeUInt16LE(0, 8)
  cde.writeUInt16LE(0, 10)
  cde.writeUInt32LE(crcVal, 16)
  cde.writeUInt32LE(0, 20)
  cde.writeUInt32LE(contentBuf.length, 24)
  cde.writeUInt16LE(nameBuf.length, 28)
  cde.writeUInt16LE(0, 30)
  cde.writeUInt16LE(0, 32)
  cde.writeUInt16LE(0, 34)
  cde.writeUInt16LE(0, 36)
  cde.writeUInt32LE(0xA0000000 | 0o777, 38) // symlink external attribute
  cde.writeUInt32LE(0, 42)
  nameBuf.copy(cde, 46)

  const cdBuf = Buffer.concat([cde])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(lfh.length + contentBuf.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([lfh, contentBuf, cdBuf, eocd])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-symlink.xmind'),
  buildZipWithSymlink()
)

// Central directory bounds: offset beyond file size
function buildZipWithBadCDOffset() {
  const nameBuf = Buffer.from('content.json', 'utf-8')
  const contentBuf = Buffer.from('{}', 'utf-8')
  const lfh = Buffer.alloc(30 + nameBuf.length)
  lfh.writeUInt32LE(0x04034b50, 0)
  lfh.writeUInt16LE(20, 4)
  lfh.writeUInt16LE(0, 6)
  lfh.writeUInt16LE(0, 8)
  lfh.writeUInt32LE(0, 10)
  lfh.writeUInt32LE(0, 14)
  lfh.writeUInt32LE(contentBuf.length, 18)
  lfh.writeUInt32LE(contentBuf.length, 22)
  lfh.writeUInt16LE(nameBuf.length, 26)
  lfh.writeUInt16LE(0, 28)
  nameBuf.copy(lfh, 30)

  const cde = Buffer.alloc(46 + nameBuf.length)
  cde.writeUInt32LE(0x02014b50, 0)
  cde.writeUInt16LE(20, 4)
  cde.writeUInt16LE(20, 6)
  cde.writeUInt16LE(0, 8)
  cde.writeUInt16LE(0, 10)
  cde.writeUInt32LE(0, 16)
  cde.writeUInt32LE(0, 20)
  cde.writeUInt32LE(contentBuf.length, 24)
  cde.writeUInt16LE(nameBuf.length, 28)
  cde.writeUInt16LE(0, 30)
  cde.writeUInt16LE(0, 32)
  cde.writeUInt16LE(0, 34)
  cde.writeUInt16LE(0, 36)
  cde.writeUInt32LE(0, 38)
  cde.writeUInt32LE(0xFFFFFFFF, 42) // local header offset beyond file
  nameBuf.copy(cde, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cde.length, 12)
  eocd.writeUInt32LE(lfh.length + contentBuf.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([lfh, contentBuf, cde, eocd])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-bad-cd-offset.xmind'),
  buildZipWithBadCDOffset()
)

// Central directory size exceeds file
function buildZipWithBadCDSize() {
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(0, 8)
  eocd.writeUInt16LE(0, 10)
  eocd.writeUInt32LE(0xFFFFFFFF, 12) // CD size exceeds file
  eocd.writeUInt32LE(0, 16)
  eocd.writeUInt16LE(0, 20)
  return eocd
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-bad-cd-size.xmind'),
  buildZipWithBadCDSize()
)

console.log('P9 regression fixtures created')
