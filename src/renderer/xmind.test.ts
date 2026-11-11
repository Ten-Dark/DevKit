import { describe, expect, it } from 'vitest'
import { parseTopic, buildMarkdown, type XMindTopic } from './utils/xmind'

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
