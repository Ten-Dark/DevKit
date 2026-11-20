const fs = require('fs')
const path = require('path')

const fixturesDir = path.join(__dirname, '..', '__xmind_fixtures__')

// Parse a ZIP and show its structure
function inspectZip(filePath) {
  const buf = fs.readFileSync(filePath)
  console.log(`\n=== ${path.basename(filePath)} ===`)
  console.log(`File size: ${buf.length}`)
  
  // Find EOCD from end
  let eocdOffset = -1
  for (let i = buf.length - 4; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  
  if (eocdOffset === -1) {
    console.log('No EOCD found')
    return
  }
  
  const commentLength = buf.readUInt16LE(eocdOffset + 20)
  const expectedEnd = eocdOffset + 22 + commentLength
  console.log(`EOCD offset: ${eocdOffset}`)
  console.log(`Comment length: ${commentLength}`)
  console.log(`Expected EOF: ${expectedEnd}, Actual: ${buf.length}, Match: ${expectedEnd === buf.length}`)
  
  // Read CD info from EOCD
  const cdSize = buf.readUInt32LE(eocdOffset + 12)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  console.log(`CD size: ${cdSize}, CD offset: ${cdOffset}, Entries: ${totalEntries}`)
  
  // Parse CD entries
  let cdPos = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    if (cdPos + 46 > buf.length) {
      console.log(`  Entry ${i}: TRUNCATED`)
      break
    }
    const sig = buf.readUInt32LE(cdPos)
    if (sig !== 0x02014b50) {
      console.log(`  Entry ${i}: BAD SIG ${sig.toString(16)}`)
      break
    }
    const nameLen = buf.readUInt16LE(cdPos + 28)
    const extraLen = buf.readUInt16LE(cdPos + 30)
    const commentLen = buf.readUInt16LE(cdPos + 32)
    const compSize = buf.readUInt32LE(cdPos + 20)
    const uncompSize = buf.readUInt32LE(cdPos + 24)
    const localOffset = buf.readUInt32LE(cdPos + 42)
    const name = buf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString('utf-8')
    console.log(`  Entry ${i}: ${name} compSize=${compSize} uncompSize=${uncompSize} localOffset=${localOffset}`)
    cdPos += 46 + nameLen + extraLen + commentLen
  }
  
  // Show comment
  const comment = buf.subarray(eocdOffset + 22, eocdOffset + 22 + commentLength)
  console.log(`Comment bytes: ${comment.length}, content: ${JSON.stringify(comment.toString('utf-8'))}`)
  
  // Check for signature bytes in comment
  for (let i = 0; i < comment.length - 3; i++) {
    if (comment.readUInt32LE(i) === 0x06054b50) {
      console.log(`  !! EOCD signature found in comment at offset ${i}`)
    }
    if (comment.readUInt32LE(i) === 0x06064b50) {
      console.log(`  !! ZIP64 EOCD signature found in comment at offset ${i}`)
    }
    if (comment.readUInt32LE(i) === 0x07064b50) {
      console.log(`  !! ZIP64 Locator signature found in comment at offset ${i}`)
    }
  }
}

const files = [
  'p9-eocd-valid-comment.xmind',
  'p9-eocd-sig-in-comment.xmind',
  'p9-eocd-multi-sig-comment.xmind',
  'p9-eocd-bad-comment-len.xmind',
  'p9-eocd-truncated.xmind',
  'p9-zip64-full.xmind',
  'p9-zip64-eocd.xmind',
  'p9-zip64-sentinel.xmind',
  'single.xmind',
]

for (const f of files) {
  const fp = path.join(fixturesDir, f)
  if (fs.existsSync(fp)) {
    inspectZip(fp)
  } else {
    console.log(`\n=== ${f} === NOT FOUND`)
  }
}
