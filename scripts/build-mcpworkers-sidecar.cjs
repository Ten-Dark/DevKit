const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..');
const siblingManagerRepository = path.join(repositoryRoot, '..', 'MCPWorkers');
const nestedManagerRepository = path.join(repositoryRoot, 'MCPWorkers');
const managerRepository = path.resolve(
  process.env.MCPWORKERS_REPO ||
    (require('node:fs').existsSync(path.join(siblingManagerRepository, 'platform', 'worker-manager', 'package.json'))
      ? siblingManagerRepository
      : nestedManagerRepository),
);
const managerRoot = path.join(managerRepository, 'platform', 'worker-manager');
const managerEntry = path.join(managerRoot, 'src', 'cli.ts');
const outputDirectory = path.join(repositoryRoot, 'dist-electron', 'mcpworkers-manager');
const outputFile = path.join(outputDirectory, 'manager.mjs');

async function resolvePackageRoot(packageRequire, packageName) {
  let current = path.dirname(packageRequire.resolve(packageName));
  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    try {
      const dependency = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      if (dependency.name === packageName) return current;
    } catch {
      // Continue walking toward the package root.
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Missing MCPWorkers sidecar dependency: ' + packageName);
    current = parent;
  }
}

async function main() {
  const packagePath = path.join(managerRoot, 'package.json');
  let managerPackage;
  try {
    managerPackage = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  } catch {
    throw new Error(
      'MCPWorkers Manager source was not found. Set MCPWORKERS_REPO or place the MCPWorkers repository beside DevKit.',
    );
  }

  if (managerPackage.name !== '@mcpworkers/manager' || !managerPackage.engines?.node) {
    throw new Error('The selected MCPWorkers source does not match the supported Manager package.');
  }

  const entryStat = await fs.stat(managerEntry);
  if (!entryStat.isFile()) throw new Error('MCPWorkers Manager CLI entrypoint is missing.');
  const cliSource = await fs.readFile(managerEntry, 'utf8');
  const pathsSource = await fs.readFile(path.join(managerRoot, 'src', 'paths.ts'), 'utf8');
  if (!cliSource.includes('DEVKIT_MCPWORKERS_SHUTDOWN_PIPE')
    || !pathsSource.includes('MCPWORKERS_DATA_ROOT')) {
    throw new Error('MCPWorkers source is missing the required DevKit Runtime shutdown/data-root contract.');
  }

  const managerRequire = createRequire(packagePath);
  const { build } = managerRequire(managerRequire.resolve('esbuild'));

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  await build({
    entryPoints: [managerEntry],
    bundle: true,
    packages: 'bundle',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['yauzl'],
    outfile: outputFile,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
  });

  const yauzlRoot = await resolvePackageRoot(managerRequire, 'yauzl');
  const vendorYauzl = path.join(outputDirectory, 'vendor', 'yauzl');
  await fs.mkdir(path.dirname(vendorYauzl), { recursive: true });
  await fs.cp(yauzlRoot, vendorYauzl, { recursive: true, errorOnExist: true });

  const yauzlRequire = createRequire(path.join(yauzlRoot, 'package.json'));
  for (const packageName of ['pend', 'buffer-crc32']) {
    const source = await resolvePackageRoot(yauzlRequire, packageName);
    const destination = path.join(vendorYauzl, 'node_modules', packageName);
    await fs.cp(source, destination, { recursive: true, errorOnExist: true });
  }

  const bundledSource = await fs.readFile(outputFile, 'utf8');
  const rewrittenBundle = bundledSource.replace(
    /from ["']yauzl["']/u,
    'from "./vendor/yauzl/index.js"',
  );
  if (rewrittenBundle === bundledSource) {
    throw new Error('Could not resolve the external yauzl import in the MCPWorkers sidecar bundle.');
  }
  await fs.writeFile(outputFile, rewrittenBundle, 'utf8');

  const outputStat = await fs.stat(outputFile);
  if (!outputStat.isFile() || outputStat.size < 100_000) {
    throw new Error('MCPWorkers Manager sidecar bundle is missing or unexpectedly small.');
  }

  process.stdout.write(
    'Built MCPWorkers Manager ' + managerPackage.version +
    ' sidecar (' + outputStat.size + ' bytes) from ' + managerRepository + '.\n',
  );
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
