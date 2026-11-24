param([double]$DurationHours=2)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$supervisor=Join-Path $PSScriptRoot 'run-windows-runtime-soak-supervisor.ps1'
$taskName='DevKitRuntimeSoakStage1'
$watchdogName='DevKitRuntimeSoakWatchdog'
foreach($name in @($taskName,$watchdogName)){
  $old=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($old -and $old.State -eq 'Running'){throw "Task is already running: $name"}
  if($old){Unregister-ScheduledTask -TaskName $name -Confirm:$false}
}
$runId=Get-Date -Format 'yyyyMMdd-HHmmss'
$runDirectory=Join-Path $env:TEMP "devkit-runtime-soak-supervised-$runId"
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$ps=(Get-Command powershell.exe).Source
$quotedScript='"'+$supervisor+'"'
$quotedDir='"'+$runDirectory+'"'
$mainArgs="-NoProfile -ExecutionPolicy Bypass -File $quotedScript -RunDirectory $quotedDir -DurationHours $DurationHours"
$watchArgs="-NoProfile -ExecutionPolicy Bypass -File $quotedScript -Watchdog -RunDirectory $quotedDir"
$mainAction=New-ScheduledTaskAction -Execute $ps -Argument $mainArgs -WorkingDirectory $projectRoot
$watchAction=New-ScheduledTaskAction -Execute $ps -Argument $watchArgs -WorkingDirectory $projectRoot
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$mainSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew -StartWhenAvailable
$watchSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -StartWhenAvailable
$watchTrigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName $watchdogName -Action $watchAction -Principal $principal -Settings $watchSettings -Trigger $watchTrigger -Description 'Independent DevKit Runtime soak supervisor watchdog' | Out-Null
Register-ScheduledTask -TaskName $taskName -Action $mainAction -Principal $principal -Settings $mainSettings -Description 'DevKit Stage 1 native Runtime soak under independent watchdog' | Out-Null
Start-ScheduledTask -TaskName $watchdogName
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
$info=Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{Task=$taskName;State=(Get-ScheduledTask -TaskName $taskName).State.ToString();Watchdog=$watchdogName;WatchdogState=(Get-ScheduledTask -TaskName $watchdogName).State.ToString();DurationHours=$DurationHours;RunDirectory=$runDirectory;Manifest=(Join-Path $runDirectory 'run-manifest.json');Heartbeat=(Join-Path $runDirectory 'supervisor-heartbeat.json');ExitCode=(Join-Path $runDirectory 'exit-code.txt');LastRunTime=$info.LastRunTime;LastTaskResult=$info.LastTaskResult}|ConvertTo-Json -Depth 4
