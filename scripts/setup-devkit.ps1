$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Lates

$Root = Split-Path -Parent $PSScriptRoo
Set-Location $Roo
$NodeVersion = '22.23.5'
$NodeArchive = "node-v$NodeVersion-win-x64.zip"
$ToolsDir = Join-Path $Root '.tools'
$NodeHome = Join-Path $ToolsDir "node-v$NodeVersion-win-x64"
$NodeExe = Join-Path $NodeHome 'node.exe'
$NpmCmd = Join-Path $NodeHome 'npm.cmd'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}
function Download-OfficialFile([string]$Url, [string]$Destination) {
    & curl.exe --fail --location --silent --show-error --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 600 --output $Destination $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE): $Url" }
    if (-not (Test-Path $Destination) -or (Get-Item $Destination).Length -le 0) {
        throw "Downloaded file is empty: $Destination"
    }
}

try {
    Write-Host 'DevKit — first-time setup' -ForegroundColor Magenta
    Write-Host "Project: $Root"
    Write-Host "Local Node.js: $NodeVersion"
    if (-not (Test-Path (Join-Path $Root 'package-lock.json'))) {
        throw 'package-lock.json was not found. Run this script from a valid DevKit checkout.'
    }
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
        throw 'Windows curl.exe is required. Update Windows or install a supported curl build.'
    }

    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    if (-not (Test-Path $NodeExe)) {
        Write-Step "Downloading official Node.js $NodeVersion (portable)"
        $ArchivePath = Join-Path $ToolsDir $NodeArchive
        $ChecksumsPath = Join-Path $ToolsDir 'SHASUMS256.txt'
        $BaseUrl = "https://nodejs.org/dist/v$NodeVersion"
        Remove-Item $ArchivePath, $ChecksumsPath -Force -ErrorAction SilentlyContinue
        Download-OfficialFile "$BaseUrl/SHASUMS256.txt" $ChecksumsPath
        Download-OfficialFile "$BaseUrl/$NodeArchive" $ArchivePath

        $ChecksumLine = Get-Content $ChecksumsPath | Where-Object { $_ -match "^\s*([a-fA-F0-9]{64})\s+$([regex]::Escape($NodeArchive))\s*$" } | Select-Object -First 1
        if (-not $ChecksumLine) { throw "Official checksum for $NodeArchive was not found." }
        $ExpectedHash = ([regex]::Match($ChecksumLine, '^[\s]*([a-fA-F0-9]{64})')).Groups[1].Value.ToLowerInvariant()
        $ActualHash = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLowerInvariant()
        if ($ActualHash -ne $ExpectedHash) {
            Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
            throw 'Node.js archive SHA-256 verification failed. The archive was rejected.'
        }

        Write-Step 'Extracting verified Node.js archive'
        Expand-Archive -Path $ArchivePath -DestinationPath $ToolsDir -Force
        Remove-Item $ArchivePath, $ChecksumsPath -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $NodeExe) -or -not (Test-Path $NpmCmd)) {
        throw 'The local Node.js installation is incomplete.'
    }
    $env:PATH = "$NodeHome;$env:PATH"
    $ActualNode = (& $NodeExe --version).Trim()
    if ($ActualNode -ne "v$NodeVersion") { throw "Expected Node.js v$NodeVersion, found $ActualNode." }

    Write-Step 'Installing locked project dependencies with npm ci'
    & $NpmCmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

    Write-Step 'Installing the Electron runtime used by the development launcher'
    & $NodeExe (Join-Path $Root 'node_modules/electron/install.js')
    if ($LASTEXITCODE -ne 0) { throw "Electron runtime installation failed with exit code $LASTEXITCODE." }
    $ElectronExe = Join-Path $Root 'node_modules/electron/dist/electron.exe'
    if (-not (Test-Path $ElectronExe)) { throw 'Electron runtime executable was not installed.' }

    Write-Host ''
    Write-Host 'Setup completed successfully.' -ForegroundColor Green
    Write-Host 'Node.js and npm are stored inside .tools; no global installation or PATH change was made.'
    Write-Host 'Start DevKit.bat to open the developer menu.'
    exit 0
}
catch {
    Write-Host ''
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Check your internet connection and retry Setup DevKit.bat.'
    exit 1
}\n