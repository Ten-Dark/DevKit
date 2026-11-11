import { describe, expect, it } from 'vitest'
import { getFence, getLanguage, renderTree } from './utils/markdown'

describe('getFence', () => {
  it('returns triple backticks for plain text', () => {
    expect(getFence('plain text')).toBe('```')
  })

  it('returns triple backticks for a single backtick run', () => {
    expect(getFence('text `code` more')).toBe('```')
  })

  it('uses one more backtick than the longest run, minimum three', () => {
    expect(getFence('```code```')).toBe('````')
    expect(getFence('````code````')).toBe('`````')
  })
})

describe('getLanguage', () => {
  it('maps known extensions', () => {
    expect(getLanguage('app.ts')).toBe('typescript')
    expect(getLanguage('app.js')).toBe('javascript')
    expect(getLanguage('style.css')).toBe('css')
  })

  it('returns empty string for unknown extensions', () => {
    expect(getLanguage('data.xyz')).toBe('')
    expect(getLanguage('noextension')).toBe('')
  })

  it('resolves language by filename', () => {
    expect(getLanguage('Dockerfile')).toBe('dockerfile')
    expect(getLanguage('Makefile')).toBe('makefile')
    expect(getLanguage('.gitignore')).toBe('gitignore')
    expect(getLanguage('.env')).toBe('bash')
  })
})

describe('renderTree', () => {
  it('renders flat files', () => {
    expect(renderTree(['b.txt', 'a.txt'])).toBe('├── a.txt\n└── b.txt')
  })

  it('renders nested directories', () => {
    expect(
      renderTree(['src/main.ts', 'src/utils.ts', 'package.json'])
    ).toBe(
      '├── src\n│   ├── main.ts\n│   └── utils.ts\n└── package.json'
    )
  })

  it('handles a mixed flat and nested structure', () => {
    expect(
      renderTree(['README.md', 'src/index.ts', 'docs/guide.md'])
    ).toBe(
      '├── docs\n│   └── guide.md\n├── src\n│   └── index.ts\n└── README.md'
    )
  })

  it('returns an empty string for no paths', () => {
    expect(renderTree([])).toBe('')
  })
})
