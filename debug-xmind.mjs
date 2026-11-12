import fs from 'fs/promises'
import path from 'path'

async function main() {
  const { parseTopic, buildMarkdown } = await import('./src/shared/utils/xmind.js')
  
  const fixturesDir = path.resolve('scripts/__xmind_fixtures__')
  const zipBuf = await fs.readFile(path.join(fixturesDir, 'special.xmind'))
  
  // Find content.json in the ZIP
  let offset = 0
  let contentJson = null
  while (offset < zipBuf.length - 4) {
    const sig = zipBuf.readUInt32LE(offset)
    if (sig === 0x04034b50) {
      const nameLen = zipBuf.readUInt16LE(offset + 26)
      const extraLen = zipBuf.readUInt16LE(offset + 28)
      const dataOffset = offset + 30 + nameLen + extraLen
      const compSize = zipBuf.readUInt32LE(offset + 18)
      const name = zipBuf.slice(offset + 30, offset + 30 + nameLen).toString('utf-8')
      if (name === 'content.json') {
        contentJson = zipBuf.slice(dataOffset, dataOffset + compSize).toString('utf-8')
        break
      }
      offset = dataOffset + compSize
    } else {
      offset++
    }
  }
  
  if (!contentJson) {
    console.log('content.json not found in ZIP')
    return
  }
  
  console.log('content.json:', contentJson)
  
  const data = JSON.parse(contentJson)
  console.log('rootTopic.title:', data.rootTopic.title)
  console.log('rootTopic.children:', JSON.stringify(data.rootTopic.children))
  
  const root = parseTopic(data.rootTopic)
  console.log('Parsed root title:', root.title)
  console.log('Parsed root children count:', root.children.length)
  console.log('Parsed root notes:', root.notes)
  console.log('Parsed root hyperlinks:', root.hyperlinks)
  
  const result = buildMarkdown(root)
  console.log('Markdown output:')
  console.log(result.markdown)
  console.log('topicCount:', result.topicCount)
  console.log('depth:', result.depth)
}

main().catch(console.error)
