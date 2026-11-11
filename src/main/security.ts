import path from 'path'

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
