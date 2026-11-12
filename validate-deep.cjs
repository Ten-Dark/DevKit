const fs = require('fs')
const buf = fs.readFileSync('src/main/__xmind_fixtures__/deep.xmind')
let offset = 0
while (offset < buf.length - 4) {
  const sig = buf.readUInt32LE(offset)
  if (sig === 0x04034b50) {
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const dataOffset = offset + 30 + nameLen + extraLen
    const compSize = buf.readUInt32LE(offset + 18)
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf-8')
    if (name === 'content.json') {
      const content = buf.slice(dataOffset, dataOffset + compSize)
      try {
        const parsed = JSON.parse(content.toString('utf-8'))
        console.log('VALID JSON. topicCount:', parsed.rootTopic ? 'has rootTopic' : 'no rootTopic')
        // Count depth
        let depth = 0
        let node = parsed.rootTopic
        while (node.children && node.children.topics && node.children.topics.length > 0) {
          depth++
          node = node.children.topics[0]
        }
        console.log('Depth:', depth)
      } catch (e) {
        console.log('INVALID JSON:', e.message)
        const str = content.toString('utf-8')
        console.log('Last 100 chars:', JSON.stringify(str.slice(-100)))
      }
      break
    }
    offset = dataOffset + compSize
  } else {
    offset++
  }
}
