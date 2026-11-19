const fs = require('fs')
const path = require('path')

const fixturesDir = path.join('scripts', '__xmind_fixtures__')

// Manual ZIP extraction - read local header data
function extractFile(zipPath, fileName) {
  const buf = fs.readFileSync(zipPath)
  let offset = 0
  
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset)
    if (sig !== 0x04034b50) break // No more local headers
    
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const compSize = buf.readUInt32LE(offset + 18)
    const uncompSize = buf.readUInt32LE(offset + 22)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8')
    const dataOffset = offset + 30 + nameLen + extraLen
    
    console.log(`  LFH: ${name} compSize=${compSize} uncompSize=${uncompSize} dataOffset=${dataOffset}`)
    
    if (name === fileName) {
      const data = buf.subarray(dataOffset, dataOffset + compSize)
      console.log(`  Data length: ${data.length}, content: ${JSON.stringify(data.toString('utf-8'))}`)
      return data
    }
    
    offset = dataOffset + compSize
  }
  return null
}

const files = [
  'p9-eocd-valid-comment.xmind',
  'p9-eocd-sig-in-comment.xmind',
  'p9-eocd-multi-sig-comment.xmind',
  'single.xmind',
]

for (const f of files) {
  const fp = path.join(fixturesDir, f)
  console.log(`\n=== ${f} ===`)
  extractFile(fp, 'content.json')
}
