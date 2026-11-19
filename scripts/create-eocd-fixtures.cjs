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

  for (const { name, content } of entries) {
    const contentBuf = Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const crcVal = crc32(contentBuf)

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
    cde.writeUInt16LE(20, 4)
    cde.writeUInt16LE(20, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(crcVal, 16)
    cde.writeUInt32LE(contentBuf.length, 20)
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

  const commentBuf = Buffer.from(options.comment || '', 'utf-8')

  const eocd = Buffer.alloc(22 + commentBuf.length)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(commentBuf.length, 20)
  commentBuf.copy(eocd, 22)

  return Buffer.concat([localHeaders, centralDir, eocd])
}

const contentJson = JSON.stringify({ rootTopic: { title: 'Test', children: { topics: [] } } })

// 1. Valid archive with no comment (reuse single.xmind for this)
// No fixture needed — single.xmind covers this

// 2. Valid archive with EOCD-like signature bytes in file DATA (not comment)
// Put 0x06054b50 bytes inside content.json data
const contentWithSig = contentJson.replace('Test', 'Test\x50\x4b\x05\x06Extra')
fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-sig-in-data.xmind'),
  buildZip([{ name: 'content.json', content: contentWithSig }])
)

// 3. Invalid EOCD with incorrect comment length (9999 but only 5 bytes exist)
function buildZipBadCommentLen(entries) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content } of entries) {
    const contentBuf = Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const crcVal = crc32(contentBuf)

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
    cde.writeUInt16LE(20, 4)
    cde.writeUInt16LE(20, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(crcVal, 16)
    cde.writeUInt32LE(contentBuf.length, 20)
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

  const commentBuf = Buffer.from('short', 'utf-8')
  const eocd = Buffer.alloc(22 + commentBuf.length)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(9999, 20) // claims 9999 but only 5 bytes exist
  commentBuf.copy(eocd, 22)

  return Buffer.concat([localHeaders, centralDir, eocd])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-bad-comment-len.xmind'),
  buildZipBadCommentLen([{ name: 'content.json', content: contentJson }])
)

// 4. Truncated EOCD (only 10 bytes instead of 22)
function buildZipTruncatedEocd(entries) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content } of entries) {
    const contentBuf = Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const crcVal = crc32(contentBuf)

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
    cde.writeUInt16LE(20, 4)
    cde.writeUInt16LE(20, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(crcVal, 16)
    cde.writeUInt32LE(contentBuf.length, 20)
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

  // Truncated EOCD: signature + 6 bytes (10 total instead of 22)
  const truncatedEocd = Buffer.alloc(10)
  truncatedEocd.writeUInt32LE(0x06054b50, 0)
  truncatedEocd.writeUInt16LE(0, 4)
  truncatedEocd.writeUInt16LE(0, 6)
  truncatedEocd.writeUInt16LE(1, 8)

  return Buffer.concat([localHeaders, centralDir, truncatedEocd])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-truncated.xmind'),
  buildZipTruncatedEocd([{ name: 'content.json', content: contentJson }])
)

// 5. Actual ZIP64 locator + EOCD structures
function buildZip64Full(entries) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content } of entries) {
    const contentBuf = Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')
    const crcVal = crc32(contentBuf)

    const lfh = Buffer.alloc(30 + nameBuf.length)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(45, 4)
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
    cde.writeUInt16LE(45, 4)
    cde.writeUInt16LE(45, 6)
    cde.writeUInt16LE(0, 8)
    cde.writeUInt16LE(0, 10)
    cde.writeUInt32LE(crcVal, 16)
    cde.writeUInt32LE(contentBuf.length, 20)
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

  const zip64EOCD = Buffer.alloc(56)
  zip64EOCD.writeUInt32LE(0x06064b50, 0)
  zip64EOCD.writeBigUInt64LE(BigInt(44), 4)
  zip64EOCD.writeUInt16LE(45, 12)
  zip64EOCD.writeUInt16LE(45, 14)
  zip64EOCD.writeUInt32LE(0, 16)
  zip64EOCD.writeUInt32LE(0, 20)
  zip64EOCD.writeBigUInt64LE(BigInt(1), 24)
  zip64EOCD.writeBigUInt64LE(BigInt(1), 32)
  zip64EOCD.writeBigUInt64LE(BigInt(centralDir.length), 40)
  zip64EOCD.writeBigUInt64LE(BigInt(offset), 48)

  const zip64Locator = Buffer.alloc(20)
  zip64Locator.writeUInt32LE(0x07064b50, 0)
  zip64Locator.writeUInt32LE(0, 4)
  zip64Locator.writeBigUInt64LE(BigInt(offset + centralDir.length), 8)
  zip64Locator.writeUInt32LE(1, 16)

  // Standard EOCD with 0xFFFF sentinel values
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(0xFFFF, 8)
  eocd.writeUInt16LE(0xFFFF, 10)
  eocd.writeUInt32LE(0xFFFFFFFF, 12)
  eocd.writeUInt32LE(0xFFFFFFFF, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localHeaders, centralDir, zip64EOCD, zip64Locator, eocd])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-zip64-full.xmind'),
  buildZip64Full([{ name: 'content.json', content: contentJson }])
)

console.log('EOCD regression fixtures created')
