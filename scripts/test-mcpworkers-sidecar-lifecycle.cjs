const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const packagedMode = process.argv.includes('--packaged');
const configuredElectronExecutable = process.env.DEVKIT_ELECTRON_EXECUTABLE;
const usePackagedExecutable = packagedMode || Boolean(configuredElectronExecutable);
const packagedExecutableCandidates = [
  path.join(repositoryRoot, 'dist', 'win-unpacked', 'Dev Toolbox.exe'),
  path.join(repositoryRoot, 'dist-electron', 'win-unpacked', 'Dev Toolbox.exe'),
];
const electronExecutable = configuredElectronExecutable
  ? path.resolve(configuredElectronExecutable)
  : usePackagedExecutable
    ? packagedExecutableCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? packagedExecutableCandidates[0]
    : path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const managerEntry = usePackagedExecutable
  ? path.join(path.dirname(electronExecutable), 'resources', 'mcpworkers-manager', 'manager.mjs')
  : path.join(repositoryRoot, 'dist-electron', 'mcpworkers-manager', 'manager.mjs');

function timeoutPromise(ms, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('The MCPWorkers Manager sidecar lifecycle smoke test requires Windows.');
  }

  await fs.access(managerEntry);
  await fs.access(electronExecutable);

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-mcpworkers-sidecar-'));
  const registryDirectory = path.join(dataRoot, 'registry');
  await fs.mkdir(registryDirectory, { recursive: true });
  await fs.writeFile(
    path.join(registryDirectory, 'registry.json'),
    JSON.stringify({ schemaVersion: 1, definitions: [], instances: [] }),
    'utf8',
  );

  const pipePath = '\\\\.\\pipe\\devkit-mcpworkers-' + randomUUID();
  const server = net.createServer();
  let managerSocket;
  let stdout = '';
  let stderr = '';
  let child;
  let readyResolve;
  let addressResolve;

  const pipeReady = new Promise((resolve, reject) => {
    readyResolve = resolve;
    server.on('connection', (socket) => {
      if (managerSocket) {
        socket.destroy();
        return;
      }
      managerSocket = socket;
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.includes('READY\n')) readyResolve();
      });
      socket.on('error', reject);
    });
    server.once('error', reject);
  });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(pipePath);
  });

  const apiAddress = new Promise((resolve, reject) => {
    addressResolve = resolve;
    const timer = setTimeout(() => reject(new Error(
      'Manager API did not become ready. stdout: ' + stdout + ' stderr: ' + stderr,
    )), 20_000);
    timer.unref();
  });

  try {
    child = spawn(electronExecutable, [
      managerEntry,
      'serve',
      '--port',
      '0',
    ], {
      cwd: path.dirname(managerEntry),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MCPWORKERS_DATA_ROOT: dataRoot,
        MCPWORKERS_DAEMON_LOCK_PORT: '0',
        DEVKIT_MCPWORKERS_SHUTDOWN_PIPE: pipePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /MCPWorkers daemon listening on http:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout);
      if (match) addressResolve('http://127.0.0.1:' + match[1]);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const exitBeforeReady = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        reject(new Error('Manager exited before readiness (' + code + '). stdout: ' + stdout + ' stderr: ' + stderr));
      });
    });

    const [address] = await Promise.race([
      Promise.all([apiAddress, pipeReady]),
      exitBeforeReady,
      timeoutPromise(25_000, 'Timed out waiting for MCPWorkers Manager startup.'),
    ]);

    const healthResponse = await fetch(address + '/v1/health', { signal: AbortSignal.timeout(3_000) });
    if (!healthResponse.ok) throw new Error('Manager health endpoint returned HTTP ' + healthResponse.status);
    const health = await healthResponse.json();
    if (health.ok !== true || health.service !== 'mcpworkers' || health.apiVersion !== 1) {
      throw new Error('Manager health response did not match API v1.');
    }

    managerSocket.write('shutdown\n');
    managerSocket.end();

    const [exitCode, signal] = await Promise.race([
      new Promise((resolve) => child.once('exit', (code, childSignal) => resolve([code, childSignal]))),
      timeoutPromise(10_000, 'Manager did not exit after the graceful Runtime shutdown request.'),
    ]);
    if (exitCode !== 0 || signal !== null) {
      throw new Error('Manager graceful shutdown returned exit=' + exitCode + ', signal=' + signal + '.');
    }

    process.stdout.write('MCPWorkers sidecar startup, API readiness and graceful named-pipe shutdown passed.\n');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        timeoutPromise(3_000, 'Manager sidecar did not exit during test cleanup.').catch(() => undefined),
      ]);
    }
    managerSocket?.destroy();
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
