const readline = require('node:readline')

const childPidFile = process.env.DEVKIT_E2E_CHILD_PID_FILE
if (childPidFile) {
  const { spawn } = require('node:child_process')
  const fs = require('node:fs')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  })
  fs.writeFileSync(childPidFile, String(child.pid))
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

input.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'devkit-e2e-fixture', version: '1.0.0' },
      },
    })
    return
  }

  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{
          name: 'fixture_ping',
          description: 'Returns a deterministic fixture response.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }],
      },
    })
    return
  }

  if (message.method === 'ping') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }

  if (message.id !== undefined) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not found: ' + String(message.method || '') },
    })
  }
})
