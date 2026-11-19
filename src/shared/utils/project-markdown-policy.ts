import type { ProjectMarkdownIssue, ProjectMarkdownStats } from '../types.js'
import { getFence, getLanguage, renderTree } from './markdown.js'

/** Hard ceiling for the complete Markdown string, measured with JavaScript string.length (UTF-16 code units). */
export const MAX_TOTAL_OUTPUT_CHARS = 5_000_000
export const MAX_EXPORT_REPORT_CHARS = 16_384
const MIN_EXPORT_REPORT_CHARS = 256

export interface ProjectMarkdownCandidate {
  relativePath: string
  size: number
}

export interface ProjectMarkdownIncludedFile extends ProjectMarkdownCandidate {
  content: string
  sectionChars: number
}

/** Files already known to be excluded by the per-file byte limit cannot appear in the document tree. */
export function getProjectMarkdownTreeCandidates(
  candidates: ProjectMarkdownCandidate[],
  maxFileSizeBytes: number,
): ProjectMarkdownCandidate[] {
  return candidates.filter((candidate) => candidate.size <= maxFileSizeBytes)
}

export interface ProjectMarkdownDocumentPlan {
  header: string
  filesHeading: string
  treeReserveChars: number
  treeIncluded: boolean
  treeOmitted: boolean
  fileSectionBudget: number
  maxTotalChars: number
}

export interface FinalizedProjectMarkdownDocument {
  markdown: string
  includedFiles: ProjectMarkdownIncludedFile[]
  stats: ProjectMarkdownStats
}

export function renderProjectMarkdownFileSection(relativePath: string, content: string): string {
  const language = getLanguage(relativePath)
  const fence = getFence(content)
  return `## ${relativePath}\n\n${fence}${language}\n${content.trimEnd()}\n${fence}\n\n`
}

export function getProjectMarkdownFileSectionLength(relativePath: string, content: string): number {
  return renderProjectMarkdownFileSection(relativePath, content).length
}

export function getProjectMarkdownLimitReason(
  candidate: ProjectMarkdownCandidate,
  maxFileSizeBytes: number,
  currentOutputChars: number,
  renderedSectionChars: number,
  maxTotalOutputChars: number,
): 'max-file-size' | 'output-limit' | null {
  if (candidate.size > maxFileSizeBytes) return 'max-file-size'
  if (currentOutputChars + renderedSectionChars > maxTotalOutputChars) return 'output-limit'
  return null
}

function getTreeSection(tree: string): string {
  return `## Structure\n\n\`\`\`text\n${tree}\n\`\`\`\n\n---\n\n`
}

function getReasonLabel(reason: ProjectMarkdownIssue['reason'], maxFileSizeKB: number): string {
  const labels: Record<ProjectMarkdownIssue['reason'], string> = {
    'internal-ignore': 'Excluded by built-in ignore rules',
    gitignore: 'Excluded by .gitignore',
    'max-file-size': `Exceeds the ${maxFileSizeKB} KB per-file size limit`,
    binary: 'Binary file',
    'read-error': 'Could not read file',
    'directory-read-error': 'Could not access directory',
    symlink: 'Symbolic link not followed',
    'unsupported-entry': 'Unsupported filesystem entry',
    'gitignore-read-error': 'Could not read .gitignore',
    'output-limit': 'Output truncated by the total Markdown document limit',
  }
  return labels[reason]
}

function formatIssuePath(relativePath: string): { value: string; shortened: boolean } {
  const normalized = relativePath.replace(/[\r\n\t]+/g, ' ')
  const shortened = normalized.length > 180
  const value = shortened ? `${normalized.slice(0, 177)}…` : normalized
  const fence = '`'.repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)))
  return { value: `${fence}${value}${fence}`, shortened }
}

const ISSUE_REASON_ORDER: ProjectMarkdownIssue['reason'][] = [
  'internal-ignore',
  'gitignore',
  'max-file-size',
  'binary',
  'read-error',
  'directory-read-error',
  'symlink',
  'unsupported-entry',
  'gitignore-read-error',
  'output-limit',
]

function compareIssuePaths(left: string, right: string): number {
  // Compare UTF-16 code units directly: deterministic across host locales and platforms.
  return left < right ? -1 : left > right ? 1 : 0
}

function buildExportReport(
  issues: ProjectMarkdownIssue[],
  stats: Pick<ProjectMarkdownStats, 'fileCount' | 'skippedCount' | 'limitedCount' | 'errorCount'>,
  treeOmitted: boolean,
  maxChars: number,
  maxFileSizeKB: number,
): { markdown: string; truncated: boolean } {
  const grouped = new Map<ProjectMarkdownIssue['reason'], ProjectMarkdownIssue[]>()
  const canonicalIssues = issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => {
      const reasonOrder = ISSUE_REASON_ORDER.indexOf(left.issue.reason) - ISSUE_REASON_ORDER.indexOf(right.issue.reason)
      return reasonOrder || compareIssuePaths(left.issue.relativePath, right.issue.relativePath) || left.index - right.index
    })
    .map(({ issue }) => issue)

  for (const issue of canonicalIssues) {
    const entries = grouped.get(issue.reason)
    if (entries) entries.push(issue)
    else grouped.set(issue.reason, [issue])
  }

  const lines = [
    '## Export report',
    '',
    `- Included files: ${stats.fileCount}`,
    `- Skipped items: ${stats.skippedCount}`,
    `- Limited files: ${stats.limitedCount}`,
    `- Processing errors: ${stats.errorCount}`,
  ]
  if (treeOmitted) lines.push('- Project tree omitted because it could not fit within the document limit')
  for (const [reason, entries] of grouped) {
    lines.push(`- ${getReasonLabel(reason, maxFileSizeKB)}: ${entries.length}`)
  }

  const base = lines.join('\n')
  if (base.length + 128 > maxChars) {
    const reasonCounts = ISSUE_REASON_ORDER
      .map((reason) => ({ reason, count: grouped.get(reason)?.length ?? 0 }))
      .filter(({ count }) => count > 0)
      .map(({ reason, count }) => `${reason}=${count}`)
      .join(', ')
    const compactLines = [
      '## Export report',
      '',
      `Included: ${stats.fileCount} · Skipped: ${stats.skippedCount} · Limited: ${stats.limitedCount} · Errors: ${stats.errorCount}`,
      `Reasons: ${reasonCounts || 'none'}`,
      `${issues.length} issue path(s) summarized${treeOmitted ? ' · project tree omitted' : ''}`,
    ]
    const compact = compactLines.join('\n')
    if (compact.length > maxChars) {
      throw new Error('The export report cannot fit while preserving all issue reason counters')
    }
    return { markdown: compact, truncated: issues.length > 0 || treeOmitted }
  }

  let markdown = base
  let omittedPaths = 0
  let shortenedPaths = false
  const footerReserve = 128
  for (const entries of grouped.values()) {
    for (const issue of entries) {
      const formatted = formatIssuePath(issue.relativePath)
      const line = `- ${formatted.value}`
      if (markdown.length + 1 + line.length + footerReserve <= maxChars) {
        markdown += `\n${line}`
        shortenedPaths ||= formatted.shortened
      } else {
        omittedPaths += 1
      }
    }
  }

  if (omittedPaths > 0) {
    const footer = `\n\n- ${omittedPaths} additional issue path(s) omitted; summary counts above are complete.`
    if (markdown.length + footer.length <= maxChars) markdown += footer
  }

  return { markdown, truncated: omittedPaths > 0 || shortenedPaths }
}

/**
 * Reserves the shell and, when it fits, the candidate tree's worst-case length.
 * Finalization measures the actual included tree and the report after file selection.
 */
export function createProjectMarkdownDocumentPlan(
  projectName: string,
  rootPath: string,
  candidates: ProjectMarkdownCandidate[],
  includeTree: boolean,
  maxTotalChars = MAX_TOTAL_OUTPUT_CHARS,
): ProjectMarkdownDocumentPlan {
  const header = `# ${projectName}\n\nGenerated from \`${rootPath}\`\n\n`
  const filesHeading = '## Files\n\n'
  if (header.length + filesHeading.length > maxTotalChars) {
    throw new Error('Project metadata exceeds the total Markdown document limit')
  }

  const candidateTree = includeTree ? getTreeSection(renderTree(candidates.map((file) => file.relativePath))) : ''
  const treeReserveChars =
    includeTree && header.length + filesHeading.length + candidateTree.length <= maxTotalChars ? candidateTree.length : 0

  return {
    header,
    filesHeading,
    treeReserveChars,
    treeIncluded: includeTree,
    treeOmitted: false,
    fileSectionBudget: maxTotalChars - header.length - filesHeading.length - treeReserveChars,
    maxTotalChars,
  }
}

/**
 * Builds the exact document, then removes tail file sections as needed until the
 * shell, actual tree, files, and bounded report all fit the same total character budget.
 */
export function finalizeProjectMarkdownDocument(
  plan: ProjectMarkdownDocumentPlan,
  candidateFiles: ProjectMarkdownIncludedFile[],
  initialIssues: ProjectMarkdownIssue[],
  maxFileSizeKB: number,
): FinalizedProjectMarkdownDocument {
  const includedFiles = [...candidateFiles]
  const issues = [...initialIssues]
  let treeIncluded = plan.treeIncluded
  let treeOmitted = plan.treeOmitted
  let totalChars = includedFiles.reduce((sum, file) => sum + file.sectionChars, 0)
  let finalState:
    | {
        treeSection: string
        report: { markdown: string; truncated: boolean }
        limitedCount: number
        skippedCount: number
        errorCount: number
      }
    | undefined

  while (true) {
    const treeSection = treeIncluded ? getTreeSection(renderTree(includedFiles.map((file) => file.relativePath))) : ''
    if (treeIncluded && plan.header.length + plan.filesHeading.length + treeSection.length > plan.maxTotalChars) {
      treeIncluded = false
      treeOmitted = true
      continue
    }
    const reportRequired = issues.length > 0 || treeOmitted
    const availableForReport = plan.maxTotalChars - plan.header.length - plan.filesHeading.length - treeSection.length - 1
    let report = { markdown: '', truncated: false }
    let limitedCount = 0
    let errorCount = 0
    let skippedCount = 0

    if (reportRequired) {
      if (availableForReport < MIN_EXPORT_REPORT_CHARS && treeIncluded) {
        treeIncluded = false
        treeOmitted = true
        continue
      }
      if (availableForReport < MIN_EXPORT_REPORT_CHARS) {
        throw new Error('The Markdown document has insufficient space for its required export report')
      }

      limitedCount = issues.filter((issue) => issue.reason === 'max-file-size' || issue.reason === 'output-limit').length
      errorCount = issues.filter((issue) =>
        issue.reason === 'read-error' || issue.reason === 'directory-read-error' || issue.reason === 'gitignore-read-error',
      ).length
      skippedCount = issues.length - limitedCount - errorCount
      report = buildExportReport(
        issues,
        { fileCount: includedFiles.length, skippedCount, limitedCount, errorCount },
        treeOmitted,
        Math.min(MAX_EXPORT_REPORT_CHARS, availableForReport),
        maxFileSizeKB,
      )
    }

    const reportSuffixChars = report.markdown ? report.markdown.length + 1 : 0
    const fileBudget = plan.maxTotalChars - plan.header.length - plan.filesHeading.length - treeSection.length - reportSuffixChars
    if (totalChars <= fileBudget) {
      finalState = { treeSection, report, limitedCount, skippedCount, errorCount }
      break
    }

    let removedAny = false
    while (totalChars > fileBudget && includedFiles.length > 0) {
      const removed = includedFiles.pop()!
      totalChars -= removed.sectionChars
      issues.push({ relativePath: removed.relativePath, reason: 'output-limit', kind: 'file' })
      removedAny = true
    }

    if (!removedAny) {
      if (treeIncluded) {
        treeIncluded = false
        treeOmitted = true
        continue
      }
      throw new Error('The generated Markdown document cannot fit within the configured total output limit')
    }
  }

  if (!finalState) throw new Error('The Markdown document could not be finalized')
  const { treeSection, report, limitedCount, skippedCount, errorCount } = finalState
  const fileCount = includedFiles.length
  const fileSections = includedFiles.map((file) => renderProjectMarkdownFileSection(file.relativePath, file.content)).join('')
  const markdown = `${plan.header}${treeSection}${plan.filesHeading}${fileSections}${report.markdown ? `${report.markdown}\n` : ''}`
  if (markdown.length > plan.maxTotalChars) {
    throw new Error('The generated Markdown document exceeds the configured total output limit')
  }

  const outputLimited = issues.some((issue) => issue.reason === 'output-limit')
  const stats: ProjectMarkdownStats = {
    fileCount,
    skippedCount,
    limitedCount,
    errorCount,
    totalChars,
    truncated: outputLimited || treeOmitted || report.truncated,
    issues,
    documentChars: markdown.length,
    treeIncluded,
    treeOmitted,
    reportTruncated: report.truncated,
  }

  return { markdown, includedFiles, stats }
}
