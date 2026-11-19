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

const content = JSON.stringify({ rootTopic: { title: 'Test', children: { topics: [] } } })

function buildZip(entries, options = {}) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content: entryContent, uncompressedSizeOverride, externalAttr } of entries) {
    const contentBuf =
      Buffer.isBuffer(entryContent) ? entryContent : Buffer.from(entryContent, 'utf-8')
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
    cde.writeUInt32LE(contentBuf.length, 20)
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

  const comment = Buffer.from(options.comment ?? '', 'utf-8')

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(comment.length, 20)

  return Buffer.concat([localHeaders, centralDir, eocd, comment])
}

fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-valid-comment.xmind'),
  buildZip([{ name: 'content.json', content }], { comment: 'This is a normal comment' })
)

fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-sig-in-comment.xmind'),
  buildZip([{ name: 'content.json', content }], { comment: 'EOCD signature PK\x05\x06 in comment' })
)

fs.writeFileSync(
  path.join(fixturesDir, 'p9-eocd-multi-sig-comment.xmind'),
  buildZip([{ name: 'content.json', content }], { comment: 'PK\x05\x06 multi PK\x05\x06 sig PK\x05\x06 comment' })
)

console.log('EOCD regression fixtures created')
