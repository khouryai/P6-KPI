@echo off
rem ---------------------------------------------------------------------------
rem  T&C P6 Budget and S-Curve
rem
rem  Starts the app. Nothing needs installing: the application is already built
rem  and is served by PowerShell, which ships with Windows.
rem
rem  Order of preference:
rem    1. A server already running on the port  -> just open the window
rem    2. Windows PowerShell                    -> server\serve.ps1
rem    3. Python, if it happens to be installed -> python -m http.server
rem    4. Nothing available                     -> open standalone\index.html
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=47800"
set "URL=http://localhost:%PORT%/"

if not exist "dist\index.html" (
  echo.
  echo   The built application is missing ^(dist\index.html^).
  echo   Copy the whole folder from the repository, not just start.cmd.
  echo.
  pause
  exit /b 1
)

rem --- 1. Already listening? -------------------------------------------------
call :IsUp && (
  echo Server already running on port %PORT%.
  goto :Open
)

rem --- 2. Windows PowerShell -------------------------------------------------
where powershell >nul 2>nul
if not errorlevel 1 (
  echo Starting the local server with PowerShell...
  start "T&C Budget server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\serve.ps1" -Port %PORT%
  call :WaitUp 15 && goto :Open
  echo PowerShell could not start the server. It may be blocked by policy on this machine.
)

rem --- 3. Python, if present -------------------------------------------------
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (where py >nul 2>nul && set "PY=py")
if defined PY (
  echo Starting the local server with Python...
  start "T&C Budget server" /min cmd /c "cd /d "%~dp0dist" && %PY% -m http.server %PORT% --bind 127.0.0.1"
  call :WaitUp 15 && goto :Open
)

rem --- 4. No server available ------------------------------------------------
echo.
echo   No local server could be started on this machine.
echo   Opening the standalone single-file version instead.
echo.
echo   It works, but it saves into the browser rather than your OneDrive folder
echo   unless you grant it the folder when it asks. Take backups from Settings.
echo.
if exist "standalone\index.html" (
  start "" "%~dp0standalone\index.html"
) else (
  echo   standalone\index.html is missing too. Re-copy the folder.
  pause
)
exit /b 0

rem --- Open the app ----------------------------------------------------------
:Open
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL%
) else (
  start "" %URL%
)
exit /b 0

rem --- Helpers ---------------------------------------------------------------
:IsUp
netstat -ano | findstr /r /c:"127\.0\.0\.1:%PORT% .*LISTENING" >nul 2>nul
exit /b %errorlevel%

:WaitUp
rem %1 = how many half-second tries before giving up
set /a "_tries=%~1"
:WaitLoop
call :IsUp && exit /b 0
set /a "_tries-=1"
if %_tries% leq 0 exit /b 1
rem ping is the portable half-second sleep on Windows
ping -n 1 -w 500 127.0.0.1 >nul 2>nul
goto :WaitLoop
