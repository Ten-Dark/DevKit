const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const fixturesDir = path.join(__dirname, '__xmind_fixtures__')
fs.mkdirSync(fixturesDir, { recursive: true })

// Minimal ZIP writer
function createZip(files) {
  let localHeaders = Buffer.alloc(0)
  let centralDir = Buffer.alloc(0)
  let offset = 0

  for (const { name, content } of files) {
    const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    const nameBuf = Buffer.from(name, 'utf-8')

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0) // signature
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0, 6) // general purpose flag
    localHeader.writeUInt16LE(0, 8) // compression method (0 = stored)
    localHeader.writeUInt32LE(0, 10) // mod time/date
    localHeader.writeUInt32LE(0, 14) // crc32
    localHeader.writeUInt32LE(contentBuf.length, 18) // compressed size
    localHeader.writeUInt32LE(contentBuf.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26) // name length
    localHeader.writeUInt16LE(0, 28) // extra field length
    nameBuf.copy(localHeader, 30)
    localHeaders = Buffer.concat([localHeaders, localHeader, contentBuf])

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + nameBuf.length)
    cdEntry.writeUInt32LE(0x02014b50, 0) // signature
    cdEntry.writeUInt16LE(20, 4) // version made by
    cdEntry.writeUInt16LE(20, 6) // version needed
    cdEntry.writeUInt16LE(0, 8) // flag
    cdEntry.writeUInt16LE(0, 10) // compression method
    cdEntry.writeUInt32LE(0, 12) // mod time/date
    cdEntry.writeUInt32LE(0, 16) // crc32
    cdEntry.writeUInt32LE(contentBuf.length, 20) // compressed size
    cdEntry.writeUInt32LE(contentBuf.length, 24) // uncompressed size
    cdEntry.writeUInt16LE(nameBuf.length, 28) // name length
    cdEntry.writeUInt16LE(0, 30) // extra field length
    cdEntry.writeUInt16LE(0, 32) // file comment length
    cdEntry.writeUInt16LE(0, 34) // disk start
    cdEntry.writeUInt16LE(0, 36) // internal attributes
    cdEntry.writeUInt32LE(0, 38) // external attributes
    cdEntry.writeUInt32LE(offset, 42) // relative offset of local header
    nameBuf.copy(cdEntry, 46)

    centralDir = Buffer.concat([centralDir, cdEntry])
    offset += localHeader.length + contentBuf.length
  }

  // End of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central directory
  eocd.writeUInt16LE(files.length, 8) // entries on this disk
  eocd.writeUInt16LE(files.length, 10) // total entries
  eocd.writeUInt32LE(centralDir.length, 12) // central directory size
  eocd.writeUInt32LE(offset, 16) // offset of central directory
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localHeaders, centralDir, eocd])
}

// Single sheet XMind
const singleSheet = {
  rootTopic: {
    title: 'Root Topic',
    children: {
      topics: [
        { title: 'Child 1', notes: 'Note for child 1' },
        { title: 'Child 2', children: { topics: [{ title: 'Grandchild' }] } },
      ],
    },
  },
}

fs.writeFileSync(
  path.join(fixturesDir, 'single.xmind'),
  createZip([{ name: 'content.json', content: JSON.stringify(singleSheet) }]),
)

// Multi-sheet XMind
const multiSheet = [
  {
    rootTopic: {
      title: 'Sheet 1',
      children: { topics: [{ title: 'Child A' }] },
    },
  },
  {
    rootTopic: {
      title: 'Sheet 2',
      children: { topics: [{ title: 'Child B' }] },
    },
  },
]

fs.writeFileSync(
  path.join(fixturesDir, 'multi.xmind'),
  createZip([{ name: 'content.json', content: JSON.stringify(multiSheet) }]),
)

// Deeply nested XMind (tests stack overflow protection)
// Build a deeply nested object iteratively to avoid stack overflow during creation.
const deepDepth = 500
let deepTopic = { title: `Level ${deepDepth}`, children: { topics: [] } }
for (let i = deepDepth - 1; i >= 0; i--) {
  deepTopic = { title: `Level ${i}`, children: { topics: [deepTopic] } }
}
const deepSheet = { rootTopic: deepTopic }

fs.writeFileSync(
  path.join(fixturesDir, 'deep.xmind'),
  createZip([{ name: 'content.json', content: JSON.stringify(deepSheet) }]),
)

// XMind with content.json in subdirectory
const nestedSheet = {
  rootTopic: { title: 'Nested', children: { topics: [] } },
}

fs.writeFileSync(
  path.join(fixturesDir, 'nested.xmind'),
  createZip([
    { name: 'some_folder/content.json', content: JSON.stringify(nestedSheet) },
    { name: 'some_folder/other.txt', content: 'ignore me' },
  ]),
)

// XMind with special characters in notes and links
const specialSheet = {
  rootTopic: {
    title: 'Root',
    children: {
      topics: [
        {
          title: 'Topic with # heading',
          notes: 'This is a note\n# This looks like a heading\nLine 3',
          href: 'https://example.com?q=1&x=2',
        },
        {
          title: 'Topic with link',
          href: 'https://example.com/path)with)parens',
        },
      ],
    },
  },
}

fs.writeFileSync(
  path.join(fixturesDir, 'special.xmind'),
  createZip([{ name: 'content.json', content: JSON.stringify(specialSheet) }]),
)

// XMind with uppercase extension
fs.writeFileSync(
  path.join(fixturesDir, 'uppercase.XMIND'),
  createZip([{ name: 'content.json', content: JSON.stringify(singleSheet) }]),
)

// Corrupted ZIP
fs.writeFileSync(
  path.join(fixturesDir, 'corrupted.xmind'),
  Buffer.from('this is not a zip file', 'utf-8'),
)

// ZIP with content.json but no rootTopic
fs.writeFileSync(
  path.join(fixturesDir, 'nocontent.xmind'),
  createZip([{ name: 'content.json', content: JSON.stringify({ someOtherKey: 'value' }) }]),
)

console.log('Fixtures created in', fixturesDir)
