export interface XMindHyperlink {
  title: string
  href: string
}

export interface XMindTopic {
  title: string
  notes: string
  children: XMindTopic[]
  hyperlinks?: XMindHyperlink[]
  markers?: string[]
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
  const t = topic as {
    title?: unknown
    children?: unknown
    href?: unknown
    markers?: unknown
  } | null

  const title = typeof t?.title === 'string' ? t.title : ''
  const notes = jsonNotes(t)

  const hyperlinks: XMindHyperlink[] = []
  const directHref = t?.href
  if (typeof directHref === 'string' && directHref.length > 0) {
    hyperlinks.push({ title: title || 'Link', href: directHref })
  }

  const rawChildren = t?.children
  let childItems: unknown[] = []
  if (Array.isArray(rawChildren)) {
    childItems = rawChildren
  } else if (rawChildren && typeof rawChildren === 'object') {
    const topics = (rawChildren as { topics?: unknown }).topics
    if (Array.isArray(topics)) {
      childItems = topics
    }
  }

  const regularChildren: XMindTopic[] = []
  for (const child of childItems) {
    regularChildren.push(parseTopic(child))
  }

  const markers: string[] = []
  const rawMarkers = t?.markers
  if (Array.isArray(rawMarkers)) {
    for (const m of rawMarkers) {
      if (typeof m === 'string' && m.length > 0) {
        markers.push(m)
      }
    }
  }

  return {
    title,
    notes,
    children: regularChildren,
    ...(hyperlinks.length > 0 ? { hyperlinks } : {}),
    ...(markers.length > 0 ? { markers } : {}),
  }
}

function escapeMarkdownLinkText(text: string): string {
  // Escape # to prevent accidental heading creation anywhere in the text.
  let escaped = text.replace(/#/g, '\\#')
  return escaped.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function escapeMarkdownUrl(url: string): string {
  return url.replace(/\)/g, '\\)').replace(/\]/g, '\\]')
}

function escapeNoteLine(line: string): string {
  if (/^#\s/.test(line)) {
    return '\\' + line
  }
  return line
}

function formatNotes(notes: string, indent: string): string[] {
  const lines: string[] = []
  for (const rawLine of notes.split(/\r?\n/)) {
    const line = escapeNoteLine(rawLine)
    lines.push(`${indent}> ${line}`)
  }
  return lines
}

export function buildMarkdown(root: XMindTopic): {
  markdown: string
  topicCount: number
  depth: number
  hyperlinkCount: number
  markerCount: number
} {
  const lines: string[] = [`# ${root.title || 'Root'}`]
  let topicCount = 0
  let maxDepth = 0
  let hyperlinkCount = 0
  let markerCount = 0

  const stack: { node: XMindTopic; depth: number; childIndex: number }[] = []

  for (let i = root.children.length - 1; i >= 0; i--) {
    stack.push({ node: root.children[i], depth: 1, childIndex: 0 })
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const node = frame.node
    const depth = frame.depth

    if (frame.childIndex === 0) {
      topicCount += 1
      if (depth > maxDepth) maxDepth = depth

      const indent = '  '.repeat(depth)
      let line = `${indent}- ${escapeMarkdownLinkText(node.title || '')}`
      for (const hl of node.hyperlinks ?? []) {
        hyperlinkCount += 1
        line += ` [${escapeMarkdownLinkText(hl.title)}](${escapeMarkdownUrl(hl.href)})`
      }
      for (const marker of node.markers ?? []) {
        markerCount += 1
        line += ` #${marker}`
      }
      lines.push(line)

      if (node.notes) {
        const noteIndent = '  '.repeat(depth + 1)
        lines.push(...formatNotes(node.notes, noteIndent))
      }
    }

    frame.childIndex += 1

    if (frame.childIndex <= node.children.length) {
      const childIndex = frame.childIndex - 1
      if (childIndex < node.children.length) {
        stack.push({ node: node.children[childIndex], depth: depth + 1, childIndex: 0 })
      }
    } else {
      stack.pop()
    }
  }

  return {
    markdown: lines.join('\n') + '\n',
    topicCount,
    depth: maxDepth,
    hyperlinkCount,
    markerCount,
  }
}
