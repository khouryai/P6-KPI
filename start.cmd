@echo off
rem T&C P6 Budget and S-Curve: build if needed, serve on localhost, open the app.
rem Safe to run repeatedly. Install this file as a logon task to keep the server up.
setlocal
cd /d "%~dp0"
set PORT=47800

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node 20 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

if not exist dist\index.html (
  echo Building the application...
  call npm run build
  if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

rem If the server is already running on the port, just open the app.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Server already running on port %PORT%.
) else (
  echo Starting the server on http://localhost:%PORT%/ ...
  start "TC Budget server" /min cmd /c "node server\serve.mjs %PORT%"
  timeout /t 2 /nobreak >nul
)

rem Open in Edge as an app window when Edge is available, otherwise the default browser.
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist %EDGE% (
  start "" %EDGE% --app=http://localhost:%PORT%/
) else (
  start "" http://localhost:%PORT%/
)
endlocal
