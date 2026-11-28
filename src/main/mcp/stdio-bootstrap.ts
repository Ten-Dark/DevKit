import net from 'node:net'
import spawn from 'cross-spawn'

interface LaunchConfiguration {
  command: string
  args: string[]
  cwd: string
}

const pipePath = process.argv[2]
if (!pipePath) {
  process.stderr.write('MCP stdio bootstrap requires a control pipe.\n')
  process.exit(1)
}

const socket = net.createConnection(pipePath)
let input = ''
let launched = false
let finished = false

function fail(message: string): void {
  if (finished) return
  finished = true
  process.stderr.write(message.slice(0, 2_000) + '\n')
  try {
    socket.write('ERROR ' + message.replace(/[\r\n]/g, ' ').slice(0, 1_000) + '\n')
    socket.end()
  } catch {
    // The parent may already have closed the control pipe.
  }
  process.exitCode = 1
}

socket.once('connect', () => {
  socket.write('READY\n')
})

socket.on('data', (chunk: Buffer) => {
  if (launched || finished) return
  input += chunk.toString('utf8')
  if (input.length > 128 * 1024) {
    fail('MCP stdio bootstrap configuration exceeds the supported size.')
    return
  }

  const newline = input.indexOf('\n')
  if (newline < 0) return

  let configuration: LaunchConfiguration
  try {
    const value: unknown = JSON.parse(input.slice(0, newline))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Configuration must be an object.')
    }
    const record = value as Record<string, unknown>
    if (typeof record.command !== 'string' || !record.command || record.command.length > 1_024
      || !Array.isArray(record.args) || record.args.length > 128
      || !record.args.every((argument) => typeof argument === 'string' && argument.length <= 4_096)
      || typeof record.cwd !== 'string' || !record.cwd || record.cwd.length > 4_096) {
      throw new Error('Command, arguments or working directory are invalid.')
    }
    configuration = {
      command: record.command,
      args: record.args as string[],
      cwd: record.cwd,
    }
  } catch (error) {
    fail('MCP stdio bootstrap rejected its launch configuration: ' + String(error))
    return
  }

  launched = true
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE

  let child
  try {
    child = spawn(configuration.command, configuration.args, {
      cwd: configuration.cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    })
  } catch (error) {
    fail('MCP server process could not be created: ' + String(error))
    return
  }

  child.once('error', (error: Error) => {
    fail('MCP server process failed to start: ' + error.message)
  })
  child.once('spawn', () => {
    socket.write('STARTED ' + String(child.pid) + '\n')
  })
  child.once('close', (code: number | null) => {
    finished = true
    process.exitCode = code ?? 1
    socket.end()
  })
})

socket.once('error', (error) => {
  if (!launched) fail('MCP stdio bootstrap control channel failed: ' + error.message)
})
socket.once('end', () => {
  if (!launched && !finished) {
    finished = true
    process.exitCode = 1
  }
})
