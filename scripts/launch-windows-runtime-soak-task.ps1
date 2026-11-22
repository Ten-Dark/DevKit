$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskName = 'DevKitRuntimeSoakStage1'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq 'Running') {
  throw "The scheduled Runtime soak task is already running: $taskName"
}
if ($existingTask) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDirectory = Join-Path $env:TEMP "devkit-runtime-soak-stage1-$runId"
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null

$logPath = Join-Path $runDirectory 'run.log'
$exitCodePath = Join-Path $runDirectory 'exit-code.txt'
$batchPath = Join-Path $runDirectory 'run.cmd'
$nodePath = (Get-Command node.exe).Source

$batchLines = @(
  '@echo off',
  "cd /d `"$projectRoot`"",
  "`"$nodePath`" scripts\test-windows-runtime-soak.cjs > `"$logPath`" 2>&1",
  'set "SOAK_EXIT=%ERRORLEVEL%"',
  "echo %SOAK_EXIT% > `"$exitCodePath`"",
  'exit /b %SOAK_EXIT%'
)
Set-Content -Path $batchPath -Value $batchLines -Encoding Ascii

$action = New-ScheduledTaskAction -Execute $env:ComSpec -Argument ('/d /c "' + $batchPath + '"')

$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description 'DevKit Stage 1 two-hour native Runtime soak validation' | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
  TaskName = $taskName
  State = (Get-ScheduledTask -TaskName $taskName).State.ToString()
  LastRunTime = $taskInfo.LastRunTime
  LastTaskResult = $taskInfo.LastTaskResult
  RunDirectory = $runDirectory
  LogPath = $logPath
  ExitCodePath = $exitCodePath
} | ConvertTo-Json -Depth 3
