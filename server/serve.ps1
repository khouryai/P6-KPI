<#
  T&C Budget local server. No Node, no install, no admin rights.

  Serves the prebuilt files in dist\ over a plain TCP socket bound to 127.0.0.1.
  A raw TcpListener is used rather than HttpListener because HttpListener goes
  through HTTP.sys and can demand a netsh URL reservation (admin); a loopback
  TCP socket on a high port never does.

  Written for Windows PowerShell 5.1, which ships with Windows. Only .NET APIs
  are used, so nothing here depends on a newer PowerShell.

  Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 47800]
#>
param(
  [int]$Port = 47800,
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($Root)) {
  $Root = Join-Path (Split-Path -Parent $PSScriptRoot) "dist"
}
$Root = [System.IO.Path]::GetFullPath($Root)

if (-not (Test-Path -LiteralPath (Join-Path $Root "index.html"))) {
  Write-Host "No application found at $Root" -ForegroundColor Red
  Write-Host "Expected dist\index.html next to this script. Re-copy the folder from the repository." -ForegroundColor Red
  exit 1
}

$types = @{
  ".html"        = "text/html; charset=utf-8"
  ".js"          = "text/javascript; charset=utf-8"
  ".mjs"         = "text/javascript; charset=utf-8"
  ".css"         = "text/css; charset=utf-8"
  ".json"        = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"         = "image/png"
  ".svg"         = "image/svg+xml"
  ".ico"         = "image/x-icon"
  ".woff2"       = "font/woff2"
  ".map"         = "application/json; charset=utf-8"
  ".txt"         = "text/plain; charset=utf-8"
}

function Get-ContentType([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($types.ContainsKey($ext)) { return $types[$ext] }
  return "application/octet-stream"
}

# Bind first, so a port clash is reported before anything else is printed.
try {
  $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
  $listener.Start()
} catch {
  Write-Host "Could not listen on port $Port. Something else is using it." -ForegroundColor Red
  Write-Host "Start with a different port, for example:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 47801" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "  T&C Budget is running at http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Serving $Root"
Write-Host "  Leave this window open while you use the app. Close it to stop the server."
Write-Host ""

$utf8 = New-Object System.Text.UTF8Encoding($false)
# Cast to [string]: "char + string" binds on the left operand in PowerShell and does not
# reliably concatenate.
$sep = [string][System.IO.Path]::DirectorySeparatorChar
$assetsPart = $sep + "assets" + $sep

function Send-Response {
  param(
    [System.IO.Stream]$stream,
    [int]$status,
    [string]$statusText,
    [byte[]]$body,
    [string]$contentType,
    [string]$extraHeaders,
    [bool]$headOnly
  )
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $status $statusText`r`n")
  [void]$sb.Append("Content-Type: $contentType`r`n")
  [void]$sb.Append("Content-Length: " + $body.Length + "`r`n")
  [void]$sb.Append("Connection: close`r`n")
  if ($extraHeaders) { [void]$sb.Append($extraHeaders) }
  [void]$sb.Append("`r`n")
  $head = $utf8.GetBytes($sb.ToString())
  $stream.Write($head, 0, $head.Length)
  if (-not $headOnly -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 30000
      $stream = $client.GetStream()

      # Read the request head (bytes up to the blank line). GET and HEAD carry no body.
      $buffer = New-Object byte[] 8192
      $sbReq = New-Object System.Text.StringBuilder
      $deadline = [DateTime]::UtcNow.AddSeconds(5)
      while ($sbReq.ToString().IndexOf("`r`n`r`n") -lt 0 -and [DateTime]::UtcNow -lt $deadline) {
        if (-not $stream.DataAvailable) { Start-Sleep -Milliseconds 5; continue }
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { break }
        [void]$sbReq.Append($utf8.GetString($buffer, 0, $read))
        if ($sbReq.Length -gt 65536) { break }
      }
      $request = $sbReq.ToString()
      if ([string]::IsNullOrWhiteSpace($request)) { continue }

      $firstLine = $request.Split("`n")[0].Trim()
      $parts = $firstLine.Split(" ")
      $method = $parts[0]
      $target = "/"
      if ($parts.Length -ge 2) { $target = $parts[1] }

      if ($method -ne "GET" -and $method -ne "HEAD") {
        Send-Response $stream 405 "Method Not Allowed" $utf8.GetBytes("Only GET and HEAD are served.") "text/plain; charset=utf-8" "" $false
        continue
      }
      $headOnly = ($method -eq "HEAD")

      # Strip query and fragment, decode, normalise.
      $path = $target.Split("?")[0].Split("#")[0]
      try { $path = [System.Uri]::UnescapeDataString($path) } catch { }
      $relative = $path.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrEmpty($relative)) { $relative = "index.html" }

      $full = ""
      $ok = $false
      try {
        $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))
        # Refuse anything that escapes the served folder.
        if ($full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) { $ok = $true }
      } catch { $ok = $false }

      if (-not $ok) {
        Send-Response $stream 403 "Forbidden" $utf8.GetBytes("Forbidden") "text/plain; charset=utf-8" "" $headOnly
        continue
      }

      # -LiteralPath so square brackets in a name are not read as wildcards.
      if ((Test-Path -LiteralPath $full -PathType Container) -or (-not (Test-Path -LiteralPath $full -PathType Leaf))) {
        # Unknown path: hand back the app shell so hash routes and deep links work.
        $full = Join-Path $Root "index.html"
      }

      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctype = Get-ContentType $full
      $extra = ""
      if ($full.ToLowerInvariant().Contains($assetsPart)) {
        $extra = "Cache-Control: public, max-age=31536000, immutable`r`n"
      } else {
        $extra = "Cache-Control: no-cache`r`n"
      }
      if ([System.IO.Path]::GetFileName($full).ToLowerInvariant() -eq "sw.js") {
        # The service worker must be allowed to control the whole origin.
        $extra = $extra + "Service-Worker-Allowed: /`r`n"
      }
      Send-Response $stream 200 "OK" $bytes $ctype $extra $headOnly
    } catch {
      # One bad connection must never stop the server.
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop() } catch { }
}
