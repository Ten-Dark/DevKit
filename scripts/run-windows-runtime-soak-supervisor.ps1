param([switch]$Watchdog,[Parameter(Mandatory=$true)][string]$RunDirectory,[double]$DurationHours=2)
$ErrorActionPreference='Stop'
$runDir=[IO.Path]::GetFullPath($RunDirectory)
$manifestPath=Join-Path $runDir 'run-manifest.json'
$heartbeatPath=Join-Path $runDir 'supervisor-heartbeat.json'
$exitPath=Join-Path $runDir 'exit-code.txt'
$finalPath=Join-Path $runDir 'supervisor-final.json'
$watchdogLog=Join-Path $runDir 'watchdog-events.jsonl'
function Write-JsonAtomic([string]$Path,$Value) {
  $tmp="$Path.tmp"; $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Read-Json([string]$Path) { if (-not (Test-Path -LiteralPath $Path)) { return $null }; return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
function Write-WatchdogEvent([string]$Kind,$Details) {
  [pscustomobject]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');event=$Kind;details=$Details} | ConvertTo-Json -Compress -Depth 8 | Add-Content -LiteralPath $watchdogLog -Encoding UTF8
}
if ($Watchdog) {
  if ((Test-Path $finalPath) -or (Test-Path $exitPath)) { exit 0 }
  $manifest=Read-Json $manifestPath; $heartbeat=Read-Json $heartbeatPath
  if (-not $manifest -or -not $heartbeat) { exit 0 }
  $lastBeat=[DateTime]::Parse($heartbeat.timestamp).ToUniversalTime()
  $age=((Get-Date).ToUniversalTime()-$lastBeat).TotalSeconds
  if ($age -le 90) { exit 0 }
  Write-WatchdogEvent 'SUPERVISOR_HEARTBEAT_STALE' @{ageSeconds=[math]::Round($age,1);supervisorPid=$manifest.supervisorPid;childPid=$manifest.childPid}
  $childPid=[int]$manifest.childPid; $expectedStart=[DateTime]::Parse($manifest.childStartTime).ToUniversalTime()
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $childPid" -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -like '*test-windows-runtime-soak.cjs*' -and $proc.CreationDate) {
    $liveProcess=Get-Process -Id $childPid -ErrorAction SilentlyContinue
    if (-not $liveProcess) { throw "Verified child process $childPid disappeared before cleanup." }
    $actualStart=$liveProcess.StartTime.ToUniversalTime()
    if ([math]::Abs(($actualStart-$expectedStart).TotalSeconds) -lt 3) {
      Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
      Write-WatchdogEvent 'CHILD_TERMINATED_AFTER_SUPERVISOR_LOSS' @{childPid=$childPid;childStartTime=$actualStart.ToString('o')}
    } else { Write-WatchdogEvent 'PID_REUSE_GUARD_REJECTED' @{childPid=$childPid;expected=$expectedStart.ToString('o');actual=$actualStart.ToString('o')} }
  } else { Write-WatchdogEvent 'CHILD_NOT_FOUND_OR_IDENTITY_MISMATCH' @{childPid=$childPid} }
  Set-Content -LiteralPath $exitPath -Value '255' -Encoding ASCII
  Write-JsonAtomic $finalPath ([pscustomobject]@{status='SUPERVISOR_LOST';exitCode=255;detectedAt=(Get-Date).ToUniversalTime().ToString('o');heartbeatAgeSeconds=[math]::Round($age,1)})
  exit 0
}
$env:DEVKIT_SOAK_HOURS=[string]$DurationHours
$node=(Get-Command node.exe).Source
$logOut=Join-Path $runDir 'node.stdout.log'; $logErr=Join-Path $runDir 'node.stderr.log'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$soakScript=Join-Path $projectRoot 'scripts\test-windows-runtime-soak.cjs'
$supervisorPid=$PID; $start=(Get-Date).ToUniversalTime()
$process=Start-Process -FilePath $node -ArgumentList @($soakScript) -WorkingDirectory $projectRoot -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru -WindowStyle Hidden
$childStart=$process.StartTime.ToUniversalTime()
$manifest=[pscustomobject]@{runDirectory=$runDir;supervisorPid=$supervisorPid;supervisorStartTime=$start.ToString('o');childPid=$process.Id;childStartTime=$childStart.ToString('o');nodePath=$node;soakScript=$soakScript;startedAt=$start.ToString('o');stdout=$logOut;stderr=$logErr}
Write-JsonAtomic $manifestPath $manifest
Write-JsonAtomic $heartbeatPath ([pscustomobject]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');supervisorPid=$supervisorPid;childPid=$process.Id})
while (-not $process.HasExited) { Start-Sleep -Seconds 5; $process.Refresh(); Write-JsonAtomic $heartbeatPath ([pscustomobject]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');supervisorPid=$supervisorPid;childPid=$process.Id}) }
$process.WaitForExit()
$nativeExitCode=$process.ExitCode
$code=255
if ($nativeExitCode -is [int] -and $nativeExitCode -ge 0) { $code=$nativeExitCode }
if (Select-String -LiteralPath $logOut -Pattern 'RUNTIME_SOAK_PASS' -Quiet) { $code=0 }
elseif (Select-String -LiteralPath $logOut -Pattern 'RUNTIME_SOAK_FAIL' -Quiet) { $code=1 }
$crashEvents=@()
if ($code -ne 0) {
  try {
    $events=Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000,1001,1026;StartTime=$start.ToLocalTime()} -ErrorAction SilentlyContinue
    $crashEvents=@($events | Where-Object { $_.Message -match 'node.exe' -or $_.Message -match [string]$process.Id } | Select-Object TimeCreated,Id,ProviderName,Message)
    $crashEvents | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runDir 'windows-crash-events.json') -Encoding UTF8
  } catch { Write-WatchdogEvent 'CRASH_EVENT_COLLECTION_FAILED' @{message=$_.Exception.Message} }
}
Set-Content -LiteralPath $exitPath -Value "$code" -Encoding ASCII
Write-JsonAtomic $finalPath ([pscustomobject]@{status=if($code -eq 0){'COMPLETED'}else{'FAILED'};exitCode=$code;nativeExitCode=$nativeExitCode;completedAt=(Get-Date).ToUniversalTime().ToString('o');childPid=$process.Id;stdout=$logOut;stderr=$logErr;crashEventCount=$crashEvents.Count})
Unregister-ScheduledTask -TaskName 'DevKitRuntimeSoakWatchdog' -Confirm:$false -ErrorAction SilentlyContinue
exit $code
