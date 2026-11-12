import path from 'path'
import fs from 'fs/promises'

export const allowedBaseDirs = new Set<string>()
export const allowedOutputPaths = new Set<string>()

export function addAllowedBaseDir(dirPath: string): void {
  allowedBaseDirs.add(path.resolve(dirPath))
}

export function addAllowedOutputPath(filePath: string): void {
  allowedOutputPaths.add(path.resolve(filePath))
}

export function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  if (allowedOutputPaths.has(resolved)) {
    return true
  }
  for (const base of allowedBaseDirs) {
    if (isUnderBase(resolved, base)) {
      return true
    }
  }
  return false
}

export function isUnderBase(targetPath: string, basePath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

/**
 * Resolves symlinks/junctions via fs.realpath and checks that the real
 * target is under one of the allowed base directories.
 * Returns the real path on success, or throws a descriptive error.
 *
 * TOCTOU note: there is a residual time-of-check-to-time-of-use window
 * between fs.realpath() here and the subsequent fs.readFile() call in
 * readFileContent. An attacker who can replace the file at the resolved
 * path with a symlink/junction pointing outside the base directory in that
 * window could bypass this check. Eliminating this fully would require
 * opening a file descriptor first and validating the fd's target (platform-
 * specific, not implemented). The callers consistently use the resolved
 * real path for subsequent reads, so the original (possibly symlink) path
 * is never read directly.
 */
export async function resolveRealPathUnderBase(
  filePath: string,
): Promise<string> {
  const resolved = path.resolve(filePath)

  // Output paths are explicitly allowed and not subject to base-dir checks.
  if (allowedOutputPaths.has(resolved)) {
    return resolved
  }

  let realPath: string
  try {
    realPath = await fs.realpath(resolved)
  } catch {
    throw new Error(`Path does not exist: ${resolved}`)
  }

  for (const base of allowedBaseDirs) {
    const baseReal = await fs.realpath(base).catch(() => base)
    if (isUnderBase(realPath, baseReal)) {
      return realPath
    }
  }

  throw new Error(
    `Access denied: path is not in an allowed directory: ${resolved}`,
  )
}
