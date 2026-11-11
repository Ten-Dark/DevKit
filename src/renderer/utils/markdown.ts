import path from 'path'

export const LANG_MAP: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.ts': 'typescript', '.tsx': 'tsx', '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.json': 'json', '.jsonc': 'jsonc', '.xml': 'xml', '.svg': 'xml',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini',
  '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.csv': 'csv',
  '.sql': 'sql', '.py': 'python', '.rb': 'ruby', '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin', '.go': 'go', '.rs': 'rust',
  '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.c': 'c', '.h': 'c', '.hpp': 'cpp', '.swift': 'swift', '.m': 'objectivec',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat', '.dockerfile': 'dockerfile',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro', '.lua': 'lua',
  '.graphql': 'graphql', '.gql': 'graphql', '.r': 'r', '.dart': 'dart',
  '.ex': 'elixir', '.exs': 'elixir', '.clj': 'clojure', '.hs': 'haskell',
  '.tf': 'hcl', '.proto': 'protobuf', '.gradle': 'groovy', '.groovy': 'groovy'
}

export const NAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', '.gitignore': 'gitignore',
  '.gitattributes': 'gitattributes', '.env': 'bash', '.editorconfig': 'ini',
  '.npmrc': 'ini', '.prettierrc': 'json', '.eslintrc': 'json', '.babelrc': 'json'
}

export function getLanguage(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext && LANG_MAP[ext]) {
    return LANG_MAP[ext]
  }
  const low = name.toLowerCase()
  if (NAME_MAP[low]) {
    return NAME_MAP[low]
  }
  return ''
}

export function getFence(text: string): string {
  let max = 0
  let run = 0
  for (const ch of text) {
    if (ch === '`') {
      run += 1
      if (run > max) {
        max = run
      }
    } else {
      run = 0
    }
  }
  return '`'.repeat(Math.max(3, max + 1))
}

interface TreeNode {
  dirs: Record<string, TreeNode>
  files: string[]
}

export function renderTree(relativePaths: string[]): string {
  const root: TreeNode = { dirs: {}, files: [] }

  for (const rel of [...relativePaths].sort()) {
    const parts = rel.split('/')
    let node: TreeNode = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      if (isLast) {
        if (!node.files.includes(part)) {
          node.files.push(part)
        }
      } else {
        if (!node.dirs[part]) {
          node.dirs[part] = { dirs: {}, files: [] }
        }
        node = node.dirs[part]
      }
    }
  }

  const lines: string[] = []

  function renderNode(node: TreeNode, prefix: string) {
    const dirs = Object.keys(node.dirs).sort()
    const files = node.files.slice().sort()
    const entries: { kind: 'dir' | 'file'; name: string }[] = [
      ...dirs.map((name) => ({ kind: 'dir' as const, name })),
      ...files.map((name) => ({ kind: 'file' as const, name })),
    ]
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      lines.push(`${prefix}${connector}${entry.name}`)
      if (entry.kind === 'dir') {
        const extension = isLast ? '    ' : '│   '
        renderNode(node.dirs[entry.name], prefix + extension)
      }
    }
  }

  renderNode(root, '')
  return lines.join('\n')
}
