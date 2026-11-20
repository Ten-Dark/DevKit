import { describe, expect, it } from 'vitest'
import { parseTopic, buildMarkdown, type XMindTopic } from './utils/xmind'
import { parseTopicAsync, buildMarkdownAsync } from '../shared/utils/xmind'

describe('parseTopic', () => {
  it('parses a valid topic with title and children', () => {
    const topic = {
      title: 'Root',
      children: [{ title: 'Child A' }, { title: 'Child B' }]
    }
    const result = parseTopic(topic)
    expect(result.title).toBe('Root')
    expect(result.notes).toBe('')
    expect(result.children).toHaveLength(2)
    expect(result.children[0].title).toBe('Child A')
  })

  it('parses an empty/null topic', () => {
    expect(parseTopic(null)).toEqual({
      title: '',
      notes: '',
      children: []
    })
    expect(parseTopic(undefined)).toEqual({
      title: '',
      notes: '',
      children: []
    })
    expect(parseTopic({})).toEqual({
      title: '',
      notes: '',
      children: []
    })
  })

  it('parses topic with notes', () => {
    const topic = {
      title: 'Root',
      notes: 'some notes'
    }
    expect(parseTopic(topic).notes).toBe('some notes')
  })

  it('parses notes from plain object structure', () => {
    const topic = {
      title: 'Root',
      notes: { plain: { content: 'rich notes' } }
    }
    expect(parseTopic(topic).notes).toBe('rich notes')
  })

  it('parses notes from plain string structure', () => {
    const topic = {
      title: 'Root',
      notes: { plain: 'plain notes' }
    }
    expect(parseTopic(topic).notes).toBe('plain notes')
  })
})

describe('buildMarkdown', () => {
  it('builds markdown from a simple hierarchy', () => {
    const root: XMindTopic = {
      title: 'Root',
      notes: '',
      children: [
        { title: 'A', notes: 'note A', children: [] },
        { title: 'B', notes: '', children: [] }
      ]
    }
    const result = buildMarkdown(root)
    expect(result.markdown).toBe(
      '# Root\n  - A\n    > note A\n  - B\n'
    )
    expect(result.topicCount).toBe(2)
    expect(result.depth).toBe(1)
  })

  it('counts nested depth correctly', () => {
    const root: XMindTopic = {
      title: 'Root',
      notes: '',
      children: [
        {
          title: 'A',
          notes: '',
          children: [
            { title: 'A1', notes: '', children: [] },
            { title: 'A2', notes: '', children: [] }
          ]
        }
      ]
    }
    const result = buildMarkdown(root)
    expect(result.depth).toBe(2)
    expect(result.topicCount).toBe(3)
  })

  it('handles a root with no children', () => {
    const root: XMindTopic = { title: 'Solo', notes: '', children: [] }
    const result = buildMarkdown(root)
    expect(result.markdown).toBe('# Solo\n')
    expect(result.topicCount).toBe(0)
    expect(result.depth).toBe(0)
  })
})


describe('modern XMind topic collections', () => {
  it('parses attached and detached topics recursively in stable order', async () => {
    const rawTopic = {
      title: 'Modern root',
      children: {
        attached: [
          {
            title: 'Attached branch',
            children: {
              attached: [{ title: 'Nested attached' }],
              detached: [{ title: 'Nested detached' }],
            },
          },
        ],
        detached: [{ title: 'Floating topic' }],
      },
    }

    const expected = {
      title: 'Modern root',
      notes: '',
      children: [
        {
          title: 'Attached branch',
          notes: '',
          children: [
            { title: 'Nested attached', notes: '', children: [] },
            { title: 'Nested detached', notes: '', children: [] },
          ],
        },
        { title: 'Floating topic', notes: '', children: [] },
      ],
    }

    expect(parseTopic(rawTopic)).toEqual(expected)
    const asyncResult = await parseTopicAsync(rawTopic)
    expect(asyncResult.root).toEqual(expected)
    expect(asyncResult.topicCount).toBe(4)

    const rendered = await buildMarkdownAsync(asyncResult.root)
    expect(rendered.markdown).toContain('- Attached branch')
    expect(rendered.markdown).toContain('- Nested attached')
    expect(rendered.markdown).toContain('- Nested detached')
    expect(rendered.markdown).toContain('- Floating topic')
    expect(rendered.topicCount).toBe(4)
    expect(rendered.depth).toBe(2)
  })

  it('keeps legacy topics collection support', async () => {
    const rawTopic = {
      title: 'Legacy root',
      children: { topics: [{ title: 'Legacy child' }] },
    }

    expect(parseTopic(rawTopic).children.map((child) => child.title)).toEqual(['Legacy child'])
    const asyncResult = await parseTopicAsync(rawTopic)
    expect(asyncResult.root.children.map((child) => child.title)).toEqual(['Legacy child'])
  })
})

describe('cooperative XMind conversion helpers', () => {
  it('preserves the synchronous parser and Markdown output', async () => {
    const rawTopic = {
      title: 'Root',
      notes: { plain: { content: 'root note' } },
      children: [
        { title: 'A # heading', href: 'https://example.test/a)', markers: ['priority-1'], notes: 'line one\\n# note', children: [{ title: 'A1' }] },
        { title: 'B', children: { topics: [{ title: 'B1' }] } },
      ],
    }
    const syncRoot = parseTopic(rawTopic)
    const asyncParsed = await parseTopicAsync(rawTopic)
    expect(asyncParsed.root).toEqual(syncRoot)
    expect(asyncParsed.topicCount).toBe(4)
    expect(await buildMarkdownAsync(asyncParsed.root)).toEqual(buildMarkdown(syncRoot))
  })

  it('supports cancellation while parsing a large topic tree', async () => {
    const controller = new AbortController()
    const rawTopic = { title: 'Root', children: Array.from({ length: 512 }, (_, index) => ({ title: 'Topic ' + index })) }
    await expect(parseTopicAsync(rawTopic, {
      signal: controller.signal,
      onProgress: (processed) => { if (processed >= 128) controller.abort() },
    })).rejects.toThrow(/abort/i)
  })

  it('supports cancellation while rendering a large topic tree', async () => {
    const controller = new AbortController()
    const root: XMindTopic = {
      title: 'Root',
      notes: '',
      children: Array.from({ length: 512 }, (_, index) => ({ title: 'Topic ' + index, notes: '', children: [] })),
    }
    await expect(buildMarkdownAsync(root, {
      signal: controller.signal,
      onProgress: (processed) => { if (processed >= 128) controller.abort() },
    })).rejects.toThrow(/abort/i)
  })
})
