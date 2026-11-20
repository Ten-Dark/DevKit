$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Lates
$Root = Split-Path -Parent $PSScriptRoo
Set-Location $Roo
$NodeHome = Join-Path $Root '.tools\node-v22.23.5-win-x64'
$NodeExe = Join-Path $NodeHome 'node.exe'
$NpmCmd = Join-Path $NodeHome 'npm.cmd'

function Pause-Menu { Write-Host ''; Read-Host 'Press Enter to return to menu' | Out-Null }
function Invoke-Npm([string[]]$Arguments) {
    & $NpmCmd @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): npm $($Arguments -join ' ')" }
}

if (-not (Test-Path $NodeExe) -or -not (Test-Path $NpmCmd) -or -not (Test-Path (Join-Path $Root 'node_modules')) -or -not (Test-Path (Join-Path $Root 'node_modules/electron/dist/electron.exe'))) {
    Write-Host 'DevKit is not initialized. Run Setup DevKit.bat first.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close' | Out-Null
    exit 1
}
$env:PATH = "$NodeHome;$env:PATH"

while ($true) {
    Clear-Hos
    Write-Host '  DEVKIT DEVELOPER TOOLBOX' -ForegroundColor Magenta
    Write-Host "  Node.js: $((& $NodeExe --version).Trim())"
    Write-Host ''
    Write-Host '  [1] Start application (development mode)'
    Write-Host '  [2] Run quality checks (lint, TypeScript, tests)'
    Write-Host '  [3] Build Windows installer (.exe)'
    Write-Host '  [4] Run full release verification'
    Write-Host '  [5] Open project folder'
    Write-Host '  [0] Exit'
    Write-Host ''
    $Choice = Read-Host 'Select an action'
    try {
        switch ($Choice) {
            '1' { Invoke-Npm @('run','dev'); Pause-Menu }
            '2' { Invoke-Npm @('run','check'); Pause-Menu }
            '3' { Invoke-Npm @('run','package'); Write-Host "\`nInstaller output: dist-electron\" -ForegroundColor Green; Pause-Menu }
            '4' { Invoke-Npm @('run','release:check'); Pause-Menu }
            '5' { Start-Process explorer.exe -ArgumentList $Root }
            '0' { exit 0 }
            default { Write-Host 'Unknown option.' -ForegroundColor Yellow; Start-Sleep -Seconds 1 }
        }
    }
    catch {
        Write-Host "\`nERROR: $($_.Exception.Message)" -ForegroundColor Red
        Pause-Menu
    }
}\n