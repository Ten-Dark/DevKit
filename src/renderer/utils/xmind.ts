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
    const ct = child as { href?: unknown; title?: unknown } | null
    if (typeof ct?.href === 'string' && ct.href.length > 0) {
      hyperlinks.push({
        title: typeof ct.title === 'string' && ct.title.length > 0 ? ct.title : ct.href,
        href: ct.href,
      })
    } else {
      regularChildren.push(parseTopic(child))
    }
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

  function walk(node: XMindTopic, depth: number) {
    topicCount += 1
    if (depth > maxDepth) maxDepth = depth
    if (depth > 0) {
      const indent = '  '.repeat(depth)
      let line = `${indent}- ${node.title || ''}`
      for (const hl of node.hyperlinks ?? []) {
        hyperlinkCount += 1
        line += ` [${hl.title}](${hl.href})`
      }
      for (const marker of node.markers ?? []) {
        markerCount += 1
        line += ` #${marker}`
      }
      lines.push(line)
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

  return {
    markdown: lines.join('\n') + '\n',
    topicCount,
    depth: maxDepth,
    hyperlinkCount,
    markerCount,
  }
}
