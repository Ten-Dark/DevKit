import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IGNORE_PATTERNS,
  isIgnored,
  makeMatcher,
  parseGitignore,
  gitignoreMatcher
} from './utils/ignore'

describe('isIgnored', () => {
  it('ignores node_modules', () => {
    expect(isIgnored('node_modules')).toBe(true)
  })

  it('ignores lockfiles by exact name', () => {
    expect(isIgnored('package-lock.json')).toBe(true)
    expect(isIgnored('yarn.lock')).toBe(true)
  })

  it('ignores compiled binaries by wildcard', () => {
    expect(isIgnored('app.exe')).toBe(true)
    expect(isIgnored('node_modules/.bin')).toBe(true)
  })

  it('ignores env files', () => {
    expect(isIgnored('.env')).toBe(true)
    expect(isIgnored('.env.local')).toBe(true)
  })

  it('does not ignore regular source files', () => {
    expect(isIgnored('src/main.ts')).toBe(false)
    expect(isIgnored('README.md')).toBe(false)
  })
})

describe('makeMatcher', () => {
  it('matches exact patterns case-insensitively', () => {
    expect(makeMatcher('node_modules').test('NODE_MODULES')).toBe(true)
    expect(makeMatcher('node_modules').test('node_modules')).toBe(true)
    expect(makeMatcher('node_modules').test('my-node_modules')).toBe(false)
  })

  it('supports trailing wildcards', () => {
    expect(makeMatcher('*.lock').test('yarn.lock')).toBe(true)
    expect(makeMatcher('*.lock').test('package-lock.json')).toBe(false)
    expect(makeMatcher('*.lock').test('README.md')).toBe(false)
  })

  it('supports single character wildcards', () => {
    expect(makeMatcher('file.?').test('file.1')).toBe(true)
    expect(makeMatcher('file.?').test('file.12')).toBe(false)
  })

  it('escapes regex special characters', () => {
    expect(makeMatcher('package.json').test('package.json')).toBe(true)
    expect(makeMatcher('package.json').test('packageXjson')).toBe(false)
  })
})

describe('DEFAULT_IGNORE_PATTERNS', () => {
  it('includes common patterns', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.env')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('*.lock')
  })
})

describe('parseGitignore', () => {
  it('parses non-comment non-empty lines', () => {
    const content = '# comment\n\nnode_modules\n  dist  \n# another\n.env'
    expect(parseGitignore(content)).toEqual(['node_modules', 'dist', '.env'])
  })
})

describe('gitignoreMatcher', () => {
  it('matches a pattern against a relative path', () => {
    const shouldIgnore = gitignoreMatcher(['node_modules', '*.log'])
    expect(shouldIgnore('debug.log')).toBe(true)
    expect(shouldIgnore('src/main.ts')).toBe(false)
  })

  it('supports negation to re-include a matched path', () => {
    const shouldIgnore = gitignoreMatcher(['*.log', '!important.log'])
    expect(shouldIgnore('important.log')).toBe(false)
  })
})
