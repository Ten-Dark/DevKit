import ignore, { type Ignore } from 'ignore'
import path from 'path'

export interface GitignoreRuleSet {
  basePath: string
  matcher: Ignore
}

export function createGitignoreRuleSet(basePath: string, content: string): GitignoreRuleSet {
  return {
    basePath,
    matcher: ignore({ ignorecase: process.platform === 'win32' }).add(content),
  }
}

/** Applies rule files from the project root down to the candidate's parent directory. */
export function isGitignored(
  candidatePath: string,
  isDirectory: boolean,
  ruleSets: GitignoreRuleSet[],
): boolean {
  let ignored = false

  for (const ruleSet of ruleSets) {
    const relativeToRules = path.relative(ruleSet.basePath, candidatePath).split(path.sep).join('/')
    if (!relativeToRules || relativeToRules === '..' || relativeToRules.startsWith('../')) continue

    const candidate = isDirectory ? `${relativeToRules.replace(/\/$/, '')}/` : relativeToRules
    const result = ruleSet.matcher.test(candidate)
    if (result.ignored) ignored = true
    else if (result.unignored) ignored = false
  }

  return ignored
}

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules', 'bower_components', 'vendor', '.pnpm-store',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'target', 'bin', 'obj',
  '.gradle', '.terraform',
  '.cache', '.parcel-cache', '.turbo', 'coverage', '.nyc_output',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  '.git', '.svn', '.hg', '.vs', '.vscode', '.idea',
  '.venv', 'venv', 'env',
  '.env', '.env.*',
  '.env.local', '.env.development', '.env.production', '.env.staging',
  '*.pem', '*.key', '*.crt', '*.cer', '*.p12', '*.pfx', '*.jks',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'ssh_host_*',
  '*.passwd', '*.htpasswd', '.netrc', '.pgpass', 'credentials',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', '*.lock',
  '*.min.js', '*.min.css', '*.map',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.bmp', '*.svg', '*.pdf',
  '*.zip', '*.gz', '*.7z', '*.rar', '*.exe', '*.dll', '*.bin',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.mp3', '*.mp4', '*.mov',
  '*.psd', '*.sqlite', '*.db', 'thumbs.db', '.DS_Store'
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeInternalMatcher(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += escapeRegExp(ch)
  }
  return new RegExp(`^${re}$`, 'i')
}

export const IGNORE_MATCHERS = DEFAULT_IGNORE_PATTERNS.map(makeInternalMatcher)

export function isIgnored(name: string): boolean {
  return IGNORE_MATCHERS.some((matcher) => matcher.test(name))
}
