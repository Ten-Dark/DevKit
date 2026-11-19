import { describe, expect, it } from 'vitest'
import type { ProjectMarkdownIssue } from '../types.js'
import {
  createProjectMarkdownDocumentPlan,
  finalizeProjectMarkdownDocument,
  getProjectMarkdownFileSectionLength,
  getProjectMarkdownTreeCandidates,
} from './project-markdown-policy.js'

function includedFile(relativePath: string, content: string) {
  return {
    relativePath,
    size: Buffer.byteLength(content),
    content,
    sectionChars: getProjectMarkdownFileSectionLength(relativePath, content),
  }
}

describe('Project Markdown total document budget', () => {
  it('accepts a complete document exactly at the configured JavaScript string-length boundary', () => {
    const maxChars = 1200
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/projects/A', [], false, maxChars)
    const overhead = getProjectMarkdownFileSectionLength('a.ts', '')
    const content = 'x'.repeat(plan.fileSectionBudget - overhead)
    const result = finalizeProjectMarkdownDocument(plan, [includedFile('a.ts', content)], [], 1024)

    expect(result.markdown.length).toBe(maxChars)
    expect(result.stats.documentChars).toBe(result.markdown.length)
    expect(result.stats.truncated).toBe(false)
  })

  it('rejects a document one character above the limit and emits a bounded report', () => {
    const maxChars = 1200
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/projects/A', [], false, maxChars)
    const overhead = getProjectMarkdownFileSectionLength('a.ts', '')
    const content = 'x'.repeat(plan.fileSectionBudget - overhead + 1)
    const result = finalizeProjectMarkdownDocument(plan, [includedFile('a.ts', content)], [], 1024)

    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.stats.fileCount).toBe(0)
    expect(result.stats.issues).toContainEqual(expect.objectContaining({ relativePath: 'a.ts', reason: 'output-limit' }))
    expect(result.markdown).toContain('Export report')
  })

  it('measures Unicode by JavaScript UTF-16 code units', () => {
    const maxChars = 1200
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/projects/A', [], false, maxChars)
    const content = '😀'.repeat(100)
    const result = finalizeProjectMarkdownDocument(plan, [includedFile('unicode.ts', content)], [], 1024)

    expect(result.stats.documentChars).toBe(result.markdown.length)
    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.stats.totalChars).toBe(getProjectMarkdownFileSectionLength('unicode.ts', content))
  })

  it('omits a tree that cannot fit and records the omission in the report and stats', () => {
    const maxChars = 700
    const longPath = 'nested/'.repeat(200) + 'file.ts'
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [{ relativePath: longPath, size: 10 }], true, maxChars)
    const result = finalizeProjectMarkdownDocument(plan, [includedFile(longPath, '')], [], 1024)

    expect(result.stats.treeOmitted).toBe(true)
    expect(result.markdown).toContain('Project tree omitted')
    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
  })

  it('keeps a compact tree when oversized candidates are not included', () => {
    const maxChars = 1_200
    const longPath = 'nested/'.repeat(200) + 'too-large.ts'
    const candidates = [
      { relativePath: longPath, size: 2_000_000 },
      { relativePath: 'src/kept.ts', size: 20 },
    ]
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', candidates, true, maxChars)
    const result = finalizeProjectMarkdownDocument(
      plan,
      [includedFile('src/kept.ts', 'kept')],
      [{ relativePath: longPath, reason: 'max-file-size', kind: 'file' }],
      1024,
    )

    expect(result.stats.treeIncluded).toBe(true)
    expect(result.stats.treeOmitted).toBe(false)
    expect(result.markdown).toContain('src/kept.ts')
    expect(result.markdown).toContain('## Structure')
    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
  })

  it('keeps the report within budget and summarizes paths when issue volume is large', () => {
    const maxChars = 5_000
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [], false, maxChars)
    const issues: ProjectMarkdownIssue[] = Array.from({ length: 500 }, (_, index) => ({
      relativePath: 'src/' + index + '-' + 'long-path-segment/'.repeat(12) + '.ts',
      reason: 'read-error',
      kind: 'file',
    }))
    const result = finalizeProjectMarkdownDocument(plan, [], issues, 1024)

    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.stats.reportTruncated).toBe(true)
    expect(result.markdown).toContain('Could not read file: 500')
    expect(result.markdown).toContain('additional issue path(s) omitted')
  })

  it('keeps every eligible file when oversized paths are excluded before tree reservation', () => {
    const maxChars = 5_000_000
    const oversizedPath = 'deep/'.repeat(1_000) + 'oversized.bin'
    const eligible = Array.from({ length: 3_500 }, (_, index) => ({
      relativePath: `src/file-${String(index).padStart(4, '0')}.ts`,
      size: 900,
    }))
    const allCandidates = [{ relativePath: oversizedPath, size: 2_048 }, ...eligible]
    const treeCandidates = getProjectMarkdownTreeCandidates(allCandidates, 1_024)
    const allCandidatesPlan = createProjectMarkdownDocumentPlan('A', 'C:/p', allCandidates, true, maxChars)
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', treeCandidates, true, maxChars)
    const included = eligible.map((file) => includedFile(file.relativePath, 'x'.repeat(900)))

    const allFileSectionChars = included.reduce((sum, file) => sum + file.sectionChars, 0)
    expect(allCandidatesPlan.treeReserveChars).toBeGreaterThan(plan.treeReserveChars)
    expect(allCandidatesPlan.fileSectionBudget).toBeLessThan(allFileSectionChars)
    expect(plan.fileSectionBudget).toBeGreaterThan(allFileSectionChars)
    const result = finalizeProjectMarkdownDocument(
      plan,
      included,
      [{ relativePath: oversizedPath, reason: 'max-file-size', kind: 'file' }],
      1,
    )

    expect(result.stats.fileCount).toBe(3_500)
    expect(result.includedFiles).toHaveLength(3_500)
    expect(result.stats.issues).toEqual([
      { relativePath: oversizedPath, reason: 'max-file-size', kind: 'file' },
    ])
    expect(result.stats.issues.some((issue) => issue.reason === 'output-limit')).toBe(false)
    expect(result.stats.documentChars).toBe(result.markdown.length)
    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.markdown).toContain('src/file-3499.ts')
    expect(result.markdown).not.toContain('oversized.bin')
  })

  it('preserves every reason-level counter when the export report switches to compact mode', () => {
    const reasons: ProjectMarkdownIssue['reason'][] = [
      'internal-ignore', 'gitignore', 'max-file-size', 'binary', 'read-error',
      'directory-read-error', 'symlink', 'unsupported-entry', 'gitignore-read-error', 'output-limit',
    ]
    const issues: ProjectMarkdownIssue[] = reasons.map((reason, index) => ({
      relativePath: `path-${index}.entry`,
      reason,
      kind: 'file',
    }))
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [], false, 430)
    const result = finalizeProjectMarkdownDocument(plan, [], issues, 1)

    expect(result.markdown).toContain('Reasons:')
    for (const reason of reasons) expect(result.markdown).toContain(`${reason}=1`)
    expect(result.stats.reportTruncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(430)
  })

  it('renders identical export reports for permuted issues with deterministic Unicode and case ordering', () => {
    const issues: ProjectMarkdownIssue[] = [
      { relativePath: 'zeta.ts', reason: 'gitignore', kind: 'file' },
      { relativePath: 'Äther.ts', reason: 'gitignore', kind: 'file' },
      { relativePath: 'alpha.ts', reason: 'gitignore', kind: 'file' },
      { relativePath: 'Alpha.ts', reason: 'gitignore', kind: 'file' },
      { relativePath: 'same.ts', reason: 'binary', kind: 'file' },
      { relativePath: 'same.ts', reason: 'binary', kind: 'file' },
    ]
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [], false, 5_000)
    const first = finalizeProjectMarkdownDocument(plan, [], issues, 1)
    const second = finalizeProjectMarkdownDocument(plan, [], [...issues].reverse(), 1)

    expect(second.markdown).toBe(first.markdown)
    expect(first.markdown.indexOf('Excluded by .gitignore: 4')).toBeLessThan(first.markdown.indexOf('Binary file: 2'))
    expect(first.markdown.indexOf('Alpha.ts')).toBeLessThan(first.markdown.indexOf('alpha.ts'))
    expect(first.stats.issues).toHaveLength(6)
  })

  it('preserves the empty-project document and includes an empty tree when requested', () => {
    const plan = createProjectMarkdownDocumentPlan('Empty', 'C:/empty', [], true, 5_000_000)
    const result = finalizeProjectMarkdownDocument(plan, [], [], 1024)

    expect(result.markdown).toContain('## Structure')
    expect(result.markdown).toContain('## Files')
    expect(result.stats.fileCount).toBe(0)
    expect(result.stats.documentChars).toBe(result.markdown.length)
    expect(result.markdown.length).toBeLessThanOrEqual(5_000_000)
  })

  it('removes tail files consistently when their combined sections exceed the full-document budget', () => {
    const maxChars = 1_200
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [], false, maxChars)
    const first = includedFile('a.ts', 'x'.repeat(650))
    const second = includedFile('b.ts', 'y'.repeat(650))
    const result = finalizeProjectMarkdownDocument(plan, [first, second], [], 1024)

    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.stats.fileCount).toBeLessThan(2)
    expect(result.stats.issues.every((issue) => issue.reason === 'output-limit')).toBe(true)
  })

  it('budgets the tree, file sections, and export report together', () => {
    const maxChars = 1_200
    const candidates = [{ relativePath: 'src/a.ts', size: 500 }, { relativePath: 'src/b.ts', size: 500 }]
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', candidates, true, maxChars)
    const issues: ProjectMarkdownIssue[] = [{ relativePath: 'ignored.log', reason: 'gitignore', kind: 'file' }]
    const result = finalizeProjectMarkdownDocument(
      plan,
      [includedFile('src/a.ts', 'a'.repeat(500)), includedFile('src/b.ts', 'b'.repeat(500))],
      issues,
      1024,
    )

    expect(result.markdown.length).toBeLessThanOrEqual(maxChars)
    expect(result.markdown).toContain('## Structure')
    expect(result.markdown).toContain('## Export report')
    expect(result.stats.issues).toContainEqual(expect.objectContaining({ relativePath: 'ignored.log', reason: 'gitignore' }))
    expect(result.stats.issues.filter((issue) => issue.reason === 'output-limit').length).toBeGreaterThan(0)
  })

  it('reports a controlled error when even required document metadata cannot fit', () => {
    const plan = createProjectMarkdownDocumentPlan('A', 'C:/p', [], false, 100)
    expect(() => finalizeProjectMarkdownDocument(plan, [], [{ relativePath: 'x', reason: 'read-error', kind: 'file' }], 1024))
      .toThrow(/insufficient space|cannot fit/i)
  })
})
