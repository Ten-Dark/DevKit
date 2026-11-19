const [majorVersion, minorVersion] = process.versions.node.split('.').map(Number)

if (majorVersion !== 22 || minorVersion < 23) {
  console.error(
    `Unsupported Node.js ${process.versions.node}. Use Node.js 22.x (.nvmrc) to install and work on this project.`,
  )
  process.exit(1)
}
