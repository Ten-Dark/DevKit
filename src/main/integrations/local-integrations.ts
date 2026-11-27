import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'

export type LocalIntegrationId = 'localmcp' | 'localmcp-tunnel' | 'chat2agent' | 'multiaggregator'
export type LocalIntegrationState = 'running' | 'stopped' | 'starting' | 'unavailable' | 'error'

export interface LocalIntegrationStatus {
  id: LocalIntegrationId
  name: string
  state: LocalIntegrationState
  description: string
  detail?: string
  pid?: number
  canStart: boolean
  canStop: boolean
  stopHint?: string
}

interface PowerShellResult {
  localMcpAvailable: boolean
  localMcpRunning: boolean
  localMcpPid?: number
  chat2AgentAvailable: boolean
  chat2AgentReady: boolean
  chat2AgentManaged: boolean
  chat2AgentLegacyOwned: boolean
  chat2AgentKind: string
  chat2AgentPid?: number
  tunnelRunning: boolean
}

const LOCAL_DESCRIPTIONS = {
  localmcp: 'Local MCP bridge through its Cloudflare relay.',
  'localmcp-tunnel': 'OpenAI Secure MCP Tunnel with isolated LocalMCP runtime.',
  chat2agent: 'DevSpace local runtime and ngrok public MCP tunnel.',
  multiaggregator: 'Multi-AI Aggregator desktop application. DevKit can launch it but does not force-terminate it.',
} satisfies Record<LocalIntegrationId, string>

function quotePowerShell(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShell(script: string, cwd: string, timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error, code = -1) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve({ code, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('PowerShell operation timed out after ' + timeoutMs + ' ms.'))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-64_000) })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16_000) })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => finish(undefined, code ?? -1))
  })
}

function displayOutput(value: string): string {
  return value.split(/\r?\n/)
    .filter((line) => !/https?:\/\/\S+|MCP URL:|Public MCP URL:|Authorization:|token|api.?key|password|secret|credential|bearer/i.test(line))
    .join('\n')
    .trim()
    .slice(0, 1_000)
}

function parsePowerShellResult(value: string): PowerShellResult {
  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('PowerShell returned an invalid local integrations status payload.')
  }
  const parsed: unknown = JSON.parse(value.slice(firstBrace, lastBrace + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PowerShell returned an invalid local integrations status payload.')
  }
  const record = parsed as Record<string, unknown>
  return {
    localMcpAvailable: record.localMcpAvailable === true,
    localMcpRunning: record.localMcpRunning === true,
    ...(typeof record.localMcpPid === 'number' && Number.isInteger(record.localMcpPid)
      ? { localMcpPid: record.localMcpPid }
      : {}),
    chat2AgentAvailable: record.chat2AgentAvailable === true,
    chat2AgentReady: record.chat2AgentReady === true,
    chat2AgentManaged: record.chat2AgentManaged === true || record.chat2AgentReady === true,
    chat2AgentLegacyOwned: record.chat2AgentLegacyOwned === true,
    chat2AgentKind: typeof record.chat2AgentKind === 'string'
      ? record.chat2AgentKind
      : record.chat2AgentReady === true ? 'ready' : 'stopped',
    ...(typeof record.chat2AgentPid === 'number' && Number.isInteger(record.chat2AgentPid)
      ? { chat2AgentPid: record.chat2AgentPid }
      : {}),
    tunnelRunning: record.tunnelRunning === true,
  }
}

export class LocalIntegrationsManager {
  private readonly settingsPath: string
  private projectsRoot = path.join(os.homedir(), 'Projects')
  private initialized?: Promise<void>
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(settingsPath = path.join(resolveWorkspacePaths().services, 'local-integrations.json')) {
    this.settingsPath = settingsPath
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.loadSettings()
    return this.initialized
  }

  private async loadSettings(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Local integrations settings must be a regular file.')
      if (stat.size > 64 * 1024) throw new Error('Local integrations settings are too large.')
      const parsed: unknown = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid local integrations settings.')
      const record = parsed as Record<string, unknown>
      if (record.schemaVersion !== 1 || typeof record.projectsRoot !== 'string' || !path.isAbsolute(record.projectsRoot)) {
        throw new Error('Local integrations settings use an unsupported schema.')
      }
      this.projectsRoot = path.resolve(record.projectsRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async persistSettings(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Local integrations settings destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.settingsPath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(tempPath, JSON.stringify({ schemaVersion: 1, projectsRoot: this.projectsRoot }, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.settingsPath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  async setProjectsRoot(directory: unknown): Promise<string> {
    return this.enqueue(async () => {
      await this.initialize()
      if (typeof directory !== 'string' || directory.length > 4_096 || !path.isAbsolute(directory)) {
        throw new Error('Projects directory must be an absolute path.')
      }
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Projects path must be a real directory.')
      const previous = this.projectsRoot
      this.projectsRoot = path.resolve(directory)
      try {
        await this.persistSettings()
      } catch (error) {
        this.projectsRoot = previous
        throw error
      }
      return this.projectsRoot
    })
  }

  async getProjectsRoot(): Promise<string> {
    await this.initialize()
    return this.projectsRoot
  }

  private getLocalMcpCli(): string {
    const appData = process.env.APPDATA
    if (!appData) throw new Error('APPDATA is not available.')
    return path.join(appData, 'npm', 'localmcp.cmd')
  }

  private async queryStatuses(): Promise<PowerShellResult> {
    const localCli = quotePowerShell(this.getLocalMcpCli())
    const chatPackage = quotePowerShell(path.join(this.projectsRoot, 'Chat2Agent', 'package.json'))
    const chatStatus = quotePowerShell(path.join(this.projectsRoot, 'Chat2Agent', 'service-status.mjs'))
    const script = [
      "$localAvailable = Test-Path -LiteralPath " + localCli,
      "$localText = ''",
      "if ($localAvailable) { $localText = (& " + localCli + " status 2>&1 | Out-String) }",
      "$localPidText = [regex]::Match($localText, 'PID:\\s*(\\d+)').Groups[1].Value -as [int]",
      "$localMcpRunning = $localText -match 'Status:\\s*running'",
      "$chatAvailable = Test-Path -LiteralPath " + chatPackage,
      "$chatKind = 'unavailable'",
      "$chatReady = $false",
      "$chatManaged = $false",
      "$chatLegacyOwned = $false",
      "$chatPidText = $null",
      "if ($chatAvailable) {",
      "Push-Location (Split-Path -Parent " + chatStatus + ")",
      "try {",
      "$chatText = (& node " + chatStatus + " --json 2>&1 | Out-String)",
      "$chatDocument = $chatText | ConvertFrom-Json -ErrorAction Stop",
      "$chatKind = [string]$chatDocument.kind",
      "$chatReady = $chatKind -eq 'ready'",
      "$chatManaged = $chatDocument.managerOwned -eq $true",
      "$chatLegacyOwned = $chatKind -eq 'legacy-devspace'",
      "if ($chatManaged -and $chatDocument.state.managerPid -match '^\\d+$') { $chatPidText = [int]$chatDocument.state.managerPid }",
      "} finally { Pop-Location }",
      "}",
      "$tunnelRunning = @(Get-Process -Name 'tunnel-client' -ErrorAction SilentlyContinue).Count -gt 0",
      "[pscustomobject]@{ localMcpAvailable = [bool]$localAvailable; localMcpRunning = [bool]$localMcpRunning; localMcpPid = $localPidText; chat2AgentAvailable = [bool]$chatAvailable; chat2AgentReady = [bool]$chatReady; chat2AgentManaged = [bool]$chatManaged; chat2AgentLegacyOwned = [bool]$chatLegacyOwned; chat2AgentKind = $chatKind; chat2AgentPid = $chatPidText; tunnelRunning = [bool]$tunnelRunning } | ConvertTo-Json -Compress"
    ].join('\n')
    const result = await runPowerShell(script, this.projectsRoot, 15_000)
    if (result.code !== 0) {
      throw new Error(displayOutput(result.stderr || result.stdout) || 'Could not query local integrations.')
    }
    return parsePowerShellResult(result.stdout)
  }

  private toStatusSnapshot(snapshot: PowerShellResult): LocalIntegrationStatus[] {
    const localMcp: LocalIntegrationStatus = {
      id: 'localmcp',
      name: 'LocalMCP',
      state: !snapshot.localMcpAvailable ? 'unavailable' : snapshot.localMcpRunning ? 'running' : 'stopped',
      description: LOCAL_DESCRIPTIONS.localmcp,
      ...(snapshot.localMcpPid ? { pid: snapshot.localMcpPid } : {}),
      detail: !snapshot.localMcpAvailable
        ? 'Global localmcp CLI was not found in the npm user directory.'
        : snapshot.localMcpRunning ? 'Background agent is running.' : 'Agent is stopped.',
      canStart: snapshot.localMcpAvailable,
      canStop: snapshot.localMcpRunning,
    }

    const tunnel: LocalIntegrationStatus = {
      id: 'localmcp-tunnel',
      name: 'LocalMCP Tunnel',
      state: snapshot.tunnelRunning ? 'running' : 'stopped',
      description: LOCAL_DESCRIPTIONS['localmcp-tunnel'],
      detail: snapshot.tunnelRunning
        ? 'Tunnel client is active. Its PowerShell window must remain open.'
        : 'Tunnel is not running.',
      canStart: true,
      canStop: false,
      stopHint: 'Switch to the Tunnel PowerShell window and press Ctrl+C. DevKit will not force-kill this session.',
    }

    const chat2AgentCanStop = snapshot.chat2AgentManaged || snapshot.chat2AgentLegacyOwned
      || snapshot.chat2AgentKind === 'stale-state'
    const chat2Agent: LocalIntegrationStatus = {
      id: 'chat2agent',
      name: 'Chat2Agent',
      state: !snapshot.chat2AgentAvailable ? 'unavailable'
        : snapshot.chat2AgentReady ? 'running'
          : snapshot.chat2AgentManaged && snapshot.chat2AgentKind === 'starting' ? 'starting'
            : snapshot.chat2AgentKind === 'stopped' ? 'stopped' : 'error',
      description: LOCAL_DESCRIPTIONS.chat2agent,
      ...(snapshot.chat2AgentPid ? { pid: snapshot.chat2AgentPid } : {}),
      detail: !snapshot.chat2AgentAvailable
        ? 'Chat2Agent was not found under the selected Projects directory.'
        : snapshot.chat2AgentReady ? 'DevSpace and public tunnel passed their health checks.'
          : snapshot.chat2AgentManaged ? 'Managed DevSpace service is unhealthy or recovering; it can be stopped safely.'
            : snapshot.chat2AgentLegacyOwned ? 'A legacy DevSpace process tree owned by this project was detected.'
              : snapshot.chat2AgentKind === 'stale-state' ? 'Stale service state was detected; it can be cleared safely.'
                : snapshot.chat2AgentKind === 'stopped' ? 'Service is stopped.'
                  : 'The configured port is occupied by a process DevKit does not own.',
      canStart: snapshot.chat2AgentAvailable && snapshot.chat2AgentKind === 'stopped',
      canStop: snapshot.chat2AgentAvailable && chat2AgentCanStop,
    }

    return [localMcp, tunnel, chat2Agent]
  }

  async getStatuses(): Promise<{ projectsRoot: string; integrations: LocalIntegrationStatus[] }> {
    await this.initialize()
    const snapshot = await this.queryStatuses()
    return { projectsRoot: this.projectsRoot, integrations: this.toStatusSnapshot(snapshot) }
  }

  async getStatus(id: Exclude<LocalIntegrationId, 'multiaggregator'>): Promise<LocalIntegrationStatus> {
    const snapshot = await this.getStatuses()
    const status = snapshot.integrations.find((item) => item.id === id)
    if (!status) throw new Error('Local integration was not found.')
    return status
  }

  private async invokeProjectScript(scriptPath: string, action: 'run' | 'status', timeoutMs: number): Promise<string> {
    const quotedPath = quotePowerShell(scriptPath)
    const command = action === 'status'
      ? '& node ' + quotedPath
      : '& ' + quotedPath
    const result = await runPowerShell(command, path.dirname(scriptPath), timeoutMs)
    if (result.code !== 0) {
      throw new Error(displayOutput(result.stderr || result.stdout) || 'Local integration command failed.')
    }
    return displayOutput(result.stdout + '\n' + result.stderr)
  }

  async start(id: Exclude<LocalIntegrationId, 'multiaggregator'>): Promise<LocalIntegrationStatus> {
    await this.initialize()
    if (id === 'localmcp') {
      const cli = quotePowerShell(this.getLocalMcpCli())
      const result = await runPowerShell('& ' + cli + ' start', this.projectsRoot, 30_000)
      if (result.code !== 0 || !/Status:\s*running/i.test(result.stdout + '\n' + result.stderr)) {
        throw new Error(displayOutput(result.stderr || result.stdout) || 'LocalMCP did not report a running state.')
      }
      return this.getStatus(id)
    }

    if (id === 'localmcp-tunnel') {
      const snapshot = await this.queryStatuses()
      if (snapshot.tunnelRunning) return this.toStatusSnapshot(snapshot)[1]
      const script = path.join(this.projectsRoot, 'MCP', 'LocalMCP-Tunnel', 'scripts', 'start-tunnel.ps1')
      await fs.access(script)
      const child = spawn(powershellPath(), [
        '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      ], {
        cwd: path.dirname(path.dirname(script)),
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        shell: false,
      })
      child.once('error', () => undefined)
      child.unref()
      return {
        id, name: 'LocalMCP Tunnel', state: 'starting',
        description: LOCAL_DESCRIPTIONS['localmcp-tunnel'],
        detail: 'Opened the Tunnel PowerShell window. Unlock KeePassXC there if requested; keep that window open.',
        canStart: true, canStop: false,
        stopHint: 'Press Ctrl+C in the Tunnel PowerShell window.',
      }
    }

    const startFile = path.join(this.projectsRoot, 'Chat2Agent', 'start.bat')
    await fs.access(startFile)
    await this.invokeProjectScript(startFile, 'run', 70_000)
    return this.getStatus(id)
  }

  async stop(id: Exclude<LocalIntegrationId, 'multiaggregator'>): Promise<LocalIntegrationStatus> {
    await this.initialize()
    if (id === 'localmcp') {
      const cli = quotePowerShell(this.getLocalMcpCli())
      const result = await runPowerShell('& ' + cli + ' stop', this.projectsRoot, 20_000)
      if (result.code !== 0) throw new Error(displayOutput(result.stderr || result.stdout) || 'LocalMCP stop failed.')
      return this.getStatus(id)
    }

    if (id === 'localmcp-tunnel') return this.getStatus(id)

    const snapshot = await this.queryStatuses()
    const currentStatus = this.toStatusSnapshot(snapshot)[2]
    if (!currentStatus.canStop) return currentStatus

    const stopFile = path.join(this.projectsRoot, 'Chat2Agent', 'stop.bat')
    await fs.access(stopFile)
    await this.invokeProjectScript(stopFile, 'run', 30_000)
    return this.getStatus(id)
  }
}
