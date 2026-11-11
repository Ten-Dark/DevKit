export interface XMindTopic {
  title: string
  notes: string
  children: XMindTopic[]
}

function jsonNotes(topic: unknown): string {
  const notes = (topic as { notes?: unknown } | null)?.notes
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  if (notes && typeof notes === 'object') {
    const plain = (notes as { plain?: unknown }).plain
    if (plain && typeof plain === 'object') {
      const content = (plain as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    }
    if (typeof plain === 'string') return plain
  }
  return ''
}

export function parseTopic(topic: unknown): XMindTopic {
  const t = topic as { title?: unknown; children?: unknown } | null
  return {
    title: typeof t?.title === 'string' ? t.title : '',
    notes: jsonNotes(t),
    children: Array.isArray(t?.children)
      ? (t.children as unknown[]).map(parseTopic)
      : [],
  }
}

export function buildMarkdown(root: XMindTopic): { markdown: string; topicCount: number; depth: number } {
  const lines: string[] = [`# ${root.title || 'Root'}`]
  let topicCount = 0
  let maxDepth = 0

  function walk(node: XMindTopic, depth: number) {
    topicCount += 1
    if (depth > maxDepth) maxDepth = depth
    if (depth > 0) {
      const indent = '  '.repeat(depth)
      lines.push(`${indent}- ${node.title || ''}`)
      if (node.notes) {
        lines.push(`${'  '.repeat(depth + 1)}> ${node.notes}`)
      }
    }
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }

  for (const child of root.children) {
    walk(child, 1)
  }

  return { markdown: lines.join('\n') + '\n', topicCount, depth: maxDepth }
}
