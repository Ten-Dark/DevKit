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
 * Resolves symlinks and Windows junctions before authorizing filesystem paths.
 * For ordinary paths, the resolved target must remain inside an approved base.
 * An explicitly selected output path may not exist yet; in that case its
 * parent is canonicalized and the returned path is built from that real parent.
 */
export async function resolveRealPathUnderBase(
  filePath: string,
  options: { allowBaseItself?: boolean; allowMissingLeaf?: boolean } = {},
): Promise<string> {
  const resolved = path.resolve(filePath)

  if (allowedOutputPaths.has(resolved)) {
    try {
      const linkStat = await fs.lstat(resolved)
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        throw new Error(`Access denied: output path is not a regular file: ${resolved}`)
      }
      const realPath = await fs.realpath(resolved)
      const realParent = await fs.realpath(path.dirname(resolved))
      if (path.dirname(realPath) !== realParent) {
        throw new Error(`Access denied: output path parent changed: ${resolved}`)
      }
      return realPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const realParent = await fs.realpath(path.dirname(resolved)).catch((parentError) => {
        throw new Error(`Output directory does not exist: ${path.dirname(resolved)}`, { cause: parentError })
      })
      return path.join(realParent, path.basename(resolved))
    }
  }

  let realPath: string
  try {
    realPath = await fs.realpath(resolved)
  } catch (error) {
    if (options.allowMissingLeaf && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      const realParent = await fs.realpath(path.dirname(resolved)).catch(() => null)
      if (realParent) {
        for (const base of allowedBaseDirs) {
          const baseReal = await fs.realpath(base).catch(() => base)
          if (realParent === baseReal || isUnderBase(realParent, baseReal)) {
            return path.join(realParent, path.basename(resolved))
          }
        }
      }
      throw new Error(`Access denied: parent directory is not in an allowed directory: ${path.dirname(resolved)}`, { cause: error })
    }
    throw new Error(`Path does not exist: ${resolved}`, { cause: error })
  }

  for (const base of allowedBaseDirs) {
    const baseReal = await fs.realpath(base).catch(() => base)
    if ((options.allowBaseItself && realPath === baseReal) || isUnderBase(realPath, baseReal)) {
      return realPath
    }
  }

  throw new Error(
    `Access denied: path is not in an allowed directory: ${resolved}`,
  )
}

function isSameFileIdentity(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

/**
 * Opens the canonical authorized target first, then verifies the open handle
 * still identifies that target. Reads are performed through the verified
 * handle so a later symlink/junction swap cannot redirect the read.
 */
export async function readAuthorizedFile(filePath: string, baseDir?: string): Promise<Buffer> {
  const realPath = await resolveRealPathUnderBase(filePath)
  const realBase = baseDir ? await fs.realpath(baseDir) : undefined
  if (realBase && !isUnderBase(realPath, realBase)) {
    throw new Error('Access denied: file target is outside the selected project root')
  }
  const handle = await fs.open(realPath, 'r')
  try {
    const handleStat = await handle.stat()
    if (!handleStat.isFile()) throw new Error('Access denied: path is not a regular file')
    const verifiedPath = await resolveRealPathUnderBase(realPath)
    const pathStat = await fs.stat(verifiedPath)
    if (
      verifiedPath !== realPath ||
      (realBase && !isUnderBase(verifiedPath, realBase)) ||
      !isSameFileIdentity(handleStat, pathStat)
    ) {
      throw new Error('Access denied: file changed during authorization')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/**
 * Writes through a verified file handle. The canonical parent is resolved
 * before creation, and the open handle is checked against the authorized path
 * before any truncation or write occurs.
 */
export async function writeAuthorizedFile(filePath: string, content: string): Promise<void> {
  const realPath = await resolveRealPathUnderBase(filePath, { allowMissingLeaf: true })
  let handle
  try {
    handle = await fs.open(realPath, 'r+')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    handle = await fs.open(realPath, 'wx')
  }

  try {
    const handleStat = await handle.stat()
    if (!handleStat.isFile()) throw new Error('Access denied: path is not a regular file')
    const verifiedPath = await resolveRealPathUnderBase(realPath)
    const pathStat = await fs.stat(verifiedPath)
    if (verifiedPath !== realPath || !isSameFileIdentity(handleStat, pathStat)) {
      throw new Error('Access denied: file changed during authorization')
    }
    await handle.truncate(0)
    await handle.writeFile(content, 'utf8')
  } finally {
    await handle.close()
  }
}
