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
rem
rem  If PowerShell is locked down on this machine you do not need this file at
rem  all. Run "Create Desktop App.cmd" once for a taskbar app with no server.
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
  rem A file copied from OneDrive, a network share or the internet carries a
  rem "mark of the web". With it, PowerShell asks "Do you want to run this
  rem script" even under -ExecutionPolicy Bypass. Unblock-File clears the mark.
  rem This runs as -Command, not as a script file, so execution policy does not
  rem gate it.
  powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0server' -Filter *.ps1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>nul

  echo Starting the local server with PowerShell...
  rem Deliberately NOT minimised: if a security prompt appears you need to see
  rem it, and the window is the server, so it has to stay open regardless.
  start "T&C Budget server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\serve.ps1" -Port %PORT%
  call :WaitUp 40 && goto :Open
  echo.
  echo   PowerShell did not bring the server up within 20 seconds.
  echo.
  echo   If a prompt appeared asking "Do you want to run this script" with
  echo   [D] Do not run  [R] Run once, this machine enforces its script policy
  echo   through Group Policy, which overrides the Bypass switch above.
  echo   Answer R and then run start.cmd again: it will find the running server
  echo   and just open the window.
  echo.
  echo   Better still, you do not need the server. Run "Create Desktop App.cmd"
  echo   once for a taskbar app with no server and no scripts.
  echo.
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

rem --- 4. One last look, in case a prompt was answered late ------------------
call :IsUp && goto :Open

rem --- 5. No server available ------------------------------------------------
echo.
echo   No local server could be started on this machine.
echo   Opening the standalone single-file version instead.
echo.
echo   It works fully, but it saves into the browser rather than your OneDrive
echo   folder unless you grant it the folder when it asks. Take backups from
echo   Settings. To get a proper taskbar app, run "Create Desktop App.cmd".
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
