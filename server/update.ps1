<#
  T&C Budget in-place updater.

  Replaces the application files in this folder with the current ones from the
  GitHub branch named in update.json. Your data is never touched: it lives in
  your storage folder or in the browser, never inside the application.

  Two routes, chosen automatically:
    1. The folder is a git clone and git is installed -> git pull --ff-only
    2. Anything else -> download the branch zip and copy the built files over

  Written for Windows PowerShell 5.1, which ships with Windows. No install, no
  admin rights, no Node.

  SAFETY RULES FOR THIS FILE, learned the hard way after a launcher script
  deleted a folder of work:
    1. Nothing under the application folder is ever deleted. Files are copied
       over the top. A file that the new version no longer ships is left behind
       rather than removed: harmless clutter beats a wrong delete.
    2. The one Remove-Item is for the download staging folder, and it runs only
       after four separate guards agree the path really is that folder.
    3. Nothing is copied until the download has been unpacked AND verified to
       contain a real build. A half-downloaded zip must leave a working app.

  Usage:  powershell -ExecutionPolicy Bypass -File update.ps1 [-AppDir <path>]
#>
param(
  [string]$AppDir = "",
  [string]$Repo = "",
  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Say([string]$text, [string]$colour = "Gray") { Write-Host $text -ForegroundColor $colour }

# [IO.Path]::Combine rather than "dist\index.html" throughout: one separator style,
# and the paths stay correct when this is exercised by the test suite off-Windows.
function P() { return [System.IO.Path]::Combine([string[]]$args) }

# --- Where is the application? ----------------------------------------------
if ([string]::IsNullOrEmpty($AppDir)) { $AppDir = Split-Path -Parent $PSScriptRoot }
# A caller that passes "C:\some path\" hands the parser a trailing \" , which it
# reads as an escaped quote, and the quote arrives inside the value. Strip quotes
# before GetFullPath rather than failing with "Illegal characters in path".
$AppDir = $AppDir.Trim().Trim([char]34).TrimEnd('\')
if ([string]::IsNullOrEmpty($AppDir)) { $AppDir = Split-Path -Parent $PSScriptRoot }
$AppDir = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\')

if (-not (Test-Path -LiteralPath (P $AppDir "dist" "index.html"))) {
  Say ""
  Say "  This does not look like the application folder:" Red
  Say "    $AppDir" Red
  Say "  Expected dist\index.html inside it. Run Update.cmd from the app folder." Yellow
  exit 1
}

# --- Which branch? -----------------------------------------------------------
# Kept in update.json rather than in this script, so moving the app to another
# branch is a one-line data change that the updater itself can deliver.
if ([string]::IsNullOrEmpty($Repo) -or [string]::IsNullOrEmpty($Branch)) {
  $cfgPath = P $PSScriptRoot "update.json"
  if (Test-Path -LiteralPath $cfgPath) {
    try {
      $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
      if ([string]::IsNullOrEmpty($Repo)) { $Repo = [string]$cfg.repo }
      if ([string]::IsNullOrEmpty($Branch)) { $Branch = [string]$cfg.branch }
    } catch {
      Say "  Could not read update.json, falling back to the built-in defaults." Yellow
    }
  }
}
if ([string]::IsNullOrEmpty($Repo)) { $Repo = "khouryai/P6-KPI" }
if ([string]::IsNullOrEmpty($Branch)) { $Branch = "claude/tc-p6-budget-scurve-fz8xis" }

function Get-Stamp([string]$root) {
  $p = P $root "dist" "build.json"
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  try { return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { return $null }
}
function Show-Stamp([string]$label, $stamp) {
  if ($null -eq $stamp) { Say ("  {0,-8} unknown (built before the updater existed)" -f $label) }
  else { Say ("  {0,-8} {1}  built {2}" -f $label, $stamp.commit, $stamp.builtAt) }
}

$before = Get-Stamp $AppDir

Say ""
Say "  T&C Budget updater" Cyan
Say "  Folder  $AppDir"
Say "  Source  $Repo  branch $Branch"
Show-Stamp "Current" $before
Say ""

# --- Route 1: a git clone ----------------------------------------------------
$hasGitDir = Test-Path -LiteralPath (P $AppDir ".git")
$gitExe = $null
try { $gitExe = (Get-Command git -ErrorAction SilentlyContinue).Source } catch { $gitExe = $null }

if ($hasGitDir -and $gitExe) {
  Say "  This folder is a git clone. Pulling..." Cyan
  Push-Location -LiteralPath $AppDir
  try {
    & $gitExe pull --ff-only
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) {
    Say ""
    Say "  git pull did not fast-forward. You have local commits or local edits." Yellow
    Say "  Sort those out in the clone, then run this again. Nothing was changed." Yellow
    exit 1
  }
  Show-Stamp "Now" (Get-Stamp $AppDir)
  Say ""
  Say "  Updated. Reload the app window, or close and reopen it." Green
  exit 0
}

if ($hasGitDir -and -not $gitExe) {
  Say "  This folder is a git clone but git is not on the PATH." Yellow
  Say "  Copying files over a clone would silently modify tracked files, so this" Yellow
  Say "  updater stops here. Install git, or use a plain copy of the folder." Yellow
  exit 1
}

# --- Route 2: download the branch zip ---------------------------------------
# codeload serves the branch as a zip with no API call and no token.
$branchPath = ($Branch.Split('/') | ForEach-Object { [System.Uri]::EscapeDataString($_) }) -join '/'
$url = "https://codeload.github.com/$Repo/zip/refs/heads/$branchPath"

# GetTempPath is TEMP on Windows and always returns something, so the guards below
# can never be comparing against an empty string.
$tempBase = [System.IO.Path]::GetTempPath().TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$stagingName = "tc-budget-update-" + [guid]::NewGuid().ToString("N")
$staging = P $tempBase $stagingName
$zipPath = P $staging "source.zip"

function Remove-Staging {
  # Four guards. An earlier script in this repo deleted a folder of work because a
  # single unset variable turned into "the current directory"; never again.
  if ([string]::IsNullOrWhiteSpace($staging)) { return }
  if ([string]::IsNullOrWhiteSpace($tempBase)) { return }
  if (-not $staging.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) { return }
  if ($staging.Length -le ($tempBase.Length + 20)) { return }
  if ($staging.IndexOf("tc-budget-update-", [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return }
  if (-not (Test-Path -LiteralPath $staging)) { return }
  try { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}

try {
  New-Item -ItemType Directory -Path $staging -Force | Out-Null

  Say "  Downloading $url" Cyan
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $wc = New-Object System.Net.WebClient
  # Corporate laptops nearly always sit behind an authenticating proxy. These two
  # lines are what make the download work there without being asked anything.
  try {
    $wc.Proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $wc.Proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials
  } catch { }
  $wc.Headers.Add("User-Agent", "tc-budget-updater")
  try {
    $wc.DownloadFile($url, $zipPath)
  } catch {
    Say ""
    Say "  The download failed: $($_.Exception.Message)" Red
    Say "  Nothing was changed. Check the network, or that the branch still exists:" Yellow
    Say "    $url" Yellow
    Remove-Staging
    exit 1
  } finally {
    $wc.Dispose()
  }

  $size = (Get-Item -LiteralPath $zipPath).Length
  Say ("  Downloaded {0:N0} KB" -f ($size / 1KB))

  $unpacked = P $staging "unpacked"
  New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $unpacked)
  } catch {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $unpacked -Force
  }

  # A branch zip always unpacks into exactly one top-level folder.
  $roots = @(Get-ChildItem -LiteralPath $unpacked -Directory)
  if ($roots.Count -ne 1) {
    Say "  The download did not look like a branch zip. Nothing was changed." Red
    Remove-Staging
    exit 1
  }
  $src = $roots[0].FullName

  # Verify BEFORE anything is copied. A truncated or wrong zip must leave the
  # working application exactly as it was.
  $required = @(@("dist", "index.html"), @("standalone", "index.html"), @("server", "serve.ps1"), @("start.cmd"))
  $missing = @()
  foreach ($parts in $required) {
    # @parts splats the segments as separate arguments. Passing the array whole
    # would collapse it into one space-joined name.
    if (-not (Test-Path -LiteralPath (P $src @parts))) { $missing += ($parts -join "\") }
  }
  if ($missing.Count -gt 0) {
    Say "  The download is missing: $($missing -join ', ')" Red
    Say "  Nothing was changed." Red
    Remove-Staging
    exit 1
  }

  $incoming = Get-Stamp $src
  Show-Stamp "New" $incoming
  if ($null -ne $before -and $null -ne $incoming -and $before.commit -eq $incoming.commit -and $before.builtAt -eq $incoming.builtAt) {
    Say ""
    Say "  Already on that build. Nothing to do." Green
    Remove-Staging
    exit 0
  }

  Say ""
  Say "  Copying the new files in..." Cyan

  # Only the program is replaced. Nothing here writes outside these paths, and
  # nothing is removed first: a file the new version dropped is simply left.
  $folders = @("dist", "standalone", "server", "public", "docs")
  $rootFiles = @("start.cmd", "Update.cmd", "Create Desktop App.cmd", "README.md")

  function Copy-WithRetry([string]$from, [string]$to, [bool]$recurse) {
    # OneDrive and the running server both hold brief locks. Five tries with a
    # growing wait is the same pattern the app itself uses for saves.
    for ($try = 1; $try -le 5; $try++) {
      try {
        if ($recurse) { Copy-Item -LiteralPath $from -Destination $to -Recurse -Force }
        else { Copy-Item -LiteralPath $from -Destination $to -Force }
        return $true
      } catch {
        if ($try -eq 5) { throw }
        Start-Sleep -Milliseconds (150 * [Math]::Pow(2, $try))
      }
    }
    return $false
  }

  $copied = 0
  foreach ($folder in $folders) {
    $from = P $src $folder
    if (-not (Test-Path -LiteralPath $from)) { continue }
    # Copy the folder's CONTENTS into the existing folder, so an existing
    # destination does not turn into dist\dist.
    $to = P $AppDir $folder
    if (-not (Test-Path -LiteralPath $to)) { New-Item -ItemType Directory -Path $to -Force | Out-Null }
    foreach ($item in (Get-ChildItem -LiteralPath $from -Force)) {
      Copy-WithRetry $item.FullName $to $true | Out-Null
    }
    $copied++
    Say "    $folder"
  }
  foreach ($file in $rootFiles) {
    $from = P $src $file
    if (-not (Test-Path -LiteralPath $from)) { continue }
    Copy-WithRetry $from (P $AppDir $file) $false | Out-Null
    $copied++
    Say "    $file"
  }

  # Scripts that came out of a zip carry the mark of the web, which makes
  # PowerShell prompt before running them. Clear it now rather than at start-up.
  try {
    Get-ChildItem -LiteralPath (P $AppDir "server") -Filter *.ps1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $AppDir -Filter *.cmd -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  } catch { }

  Say ""
  Show-Stamp "Now" (Get-Stamp $AppDir)
  Say ""
  Say "  Updated $copied items." Green
  Say "  If the app window is open it will offer to reload. Otherwise just open it." Green
  Say "  Your data was not touched: it lives in your storage folder, not in here." Green
} finally {
  Remove-Staging
}
exit 0
