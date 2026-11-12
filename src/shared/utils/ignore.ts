function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function makeMatcher(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') {
      re += '.*'
    } else if (ch === '?') {
      re += '.'
    } else {
      re += escapeRegExp(ch)
    }
  }
  return new RegExp(`^${re}$`, 'i')
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

export const IGNORE_MATCHERS = DEFAULT_IGNORE_PATTERNS.map(makeMatcher)

export function isIgnored(name: string): boolean {
  return IGNORE_MATCHERS.some((matcher) => matcher.test(name))
}

export function parseGitignore(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

export function gitignoreMatcher(patterns: string[]) {
  const matchers = patterns.map((p) => {
    const negated = p.startsWith('!')
    const pattern = negated ? p.slice(1) : p
    return { negated, matcher: makeMatcher(pattern) }
  })
  return (relPath: string) => {
    const parts = relPath.split('/')
    let ignored = false
    for (const { negated, matcher } of matchers) {
      const matches = matcher.test(relPath) || parts.some((part) => matcher.test(part))
      if (matches) {
        ignored = !negated
      }
    }
    return ignored
  }
}
