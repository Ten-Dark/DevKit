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

function createTopicNode(topic: unknown): { node: XMindTopic; childItems: unknown[] } {
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
    const children = rawChildren as {
      topics?: unknown
      attached?: unknown
      detached?: unknown
    }

    // XMind 8/legacy exports use "topics"; modern XMind uses
    // "attached" for the main tree and "detached" for floating topics.
    // Keep both collections in a deterministic order so no map content is lost.
    if (Array.isArray(children.topics)) {
      childItems = children.topics
    } else {
      if (Array.isArray(children.attached)) childItems.push(...children.attached)
      if (Array.isArray(children.detached)) childItems.push(...children.detached)
    }
  }

  const markers: string[] = []
  const rawMarkers = t?.markers
  if (Array.isArray(rawMarkers)) {
    for (const marker of rawMarkers) {
      if (typeof marker === 'string' && marker.length > 0) markers.push(marker)
    }
  }

  return {
    node: {
      title,
      notes,
      children: [],
      ...(hyperlinks.length > 0 ? { hyperlinks } : {}),
      ...(markers.length > 0 ? { markers } : {}),
    },
    childItems,
  }
}

export function parseTopic(topic: unknown): XMindTopic {
  const { node, childItems } = createTopicNode(topic)
  for (const child of childItems) node.children.push(parseTopic(child))
  return node
}

export async function parseTopicAsync(
  topic: unknown,
  options: {
    signal?: AbortSignal
    onProgress?: (processed: number) => void
    yieldEvery?: number
  } = {},
): Promise<{ root: XMindTopic; topicCount: number }> {
  const yieldEvery = Math.max(1, options.yieldEvery ?? 128)
  options.signal?.throwIfAborted()

  const { node: root, childItems } = createTopicNode(topic)
  const stack: Array<{ node: XMindTopic; children: unknown[]; nextChild: number }> = [
    { node: root, children: childItems, nextChild: 0 },
  ]
  let topicCount = 0

  while (stack.length > 0) {
    options.signal?.throwIfAborted()
    const frame = stack[stack.length - 1]
    if (frame.nextChild >= frame.children.length) {
      stack.pop()
      continue
    }

    const child = createTopicNode(frame.children[frame.nextChild++])
    frame.node.children.push(child.node)
    stack.push({ node: child.node, children: child.childItems, nextChild: 0 })
    topicCount += 1

    if (topicCount % yieldEvery === 0) {
      options.onProgress?.(topicCount)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      options.signal?.throwIfAborted()
    }
  }

  options.onProgress?.(topicCount)
  options.signal?.throwIfAborted()
  return { root, topicCount }
}

function escapeMarkdownLinkText(text: string): string {
  // Escape # to prevent accidental heading creation anywhere in the text.
  const escaped = text.replace(/#/g, '\\#')
  return escaped.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function escapeMarkdownUrl(url: string): string {
  return url.replace(/\)/g, '\\)').replace(/\]/g, '\\]')
}

function escapeNoteLine(line: string): string {
  // Prevent a line starting with # from becoming a heading.
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

  // Iterative depth-first traversal to avoid stack overflow on deep maps.
  // Stack entries: { node, depth, childIndex }
  const stack: { node: XMindTopic; depth: number; childIndex: number }[] = []

  for (let i = root.children.length - 1; i >= 0; i--) {
    stack.push({ node: root.children[i], depth: 1, childIndex: 0 })
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const node = frame.node
    const depth = frame.depth

    if (frame.childIndex === 0) {
      // First visit: process this node.
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
      // Push next child onto stack (in reverse order so they process left-to-right).
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

export async function buildMarkdownAsync(
  root: XMindTopic,
  options: {
    signal?: AbortSignal
    onProgress?: (processed: number) => void
    yieldEvery?: number
  } = {},
): Promise<{
  markdown: string
  topicCount: number
  depth: number
  hyperlinkCount: number
  markerCount: number
}> {
  const yieldEvery = Math.max(1, options.yieldEvery ?? 128)
  options.signal?.throwIfAborted()

  const lines: string[] = ['# ' + (root.title || 'Root')]
  let topicCount = 0
  let maxDepth = 0
  let hyperlinkCount = 0
  let markerCount = 0
  const stack: { node: XMindTopic; depth: number; childIndex: number }[] = []

  for (let i = root.children.length - 1; i >= 0; i--) {
    stack.push({ node: root.children[i], depth: 1, childIndex: 0 })
  }

  while (stack.length > 0) {
    options.signal?.throwIfAborted()
    const frame = stack[stack.length - 1]
    const node = frame.node
    const depth = frame.depth

    if (frame.childIndex === 0) {
      topicCount += 1
      if (depth > maxDepth) maxDepth = depth

      const indent = '  '.repeat(depth)
      let line = indent + '- ' + escapeMarkdownLinkText(node.title || '')
      for (const hyperlink of node.hyperlinks ?? []) {
        hyperlinkCount += 1
        line += ' [' + escapeMarkdownLinkText(hyperlink.title) + '](' + escapeMarkdownUrl(hyperlink.href) + ')'
      }
      for (const marker of node.markers ?? []) {
        markerCount += 1
        line += ' #' + marker
      }
      lines.push(line)

      if (node.notes) {
        const noteIndent = '  '.repeat(depth + 1)
        lines.push(...formatNotes(node.notes, noteIndent))
      }

      if (topicCount % yieldEvery === 0) {
        options.onProgress?.(topicCount)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        options.signal?.throwIfAborted()
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

  options.onProgress?.(topicCount)
  options.signal?.throwIfAborted()
  return {
    markdown: lines.join('\n') + '\n',
    topicCount,
    depth: maxDepth,
    hyperlinkCount,
    markerCount,
  }
}
