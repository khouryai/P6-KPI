@echo off
rem ---------------------------------------------------------------------------
rem  Pulls the current application code from GitHub into this folder.
rem
rem  Your data is not in here. It is in your storage folder, or in the browser.
rem  This only replaces the program, so it is safe to run whenever you like.
rem
rem  It hands straight over to server\update.ps1, which does the real work and
rem  explains itself as it goes.
rem
rem  SAFETY RULES FOR THIS FILE, learned the hard way:
rem    1. It never deletes anything. No del, erase, rd or rmdir, ever.
rem    2. It uses no ^( ^) blocks. An unescaped bracket inside an echo closes a
rem       block early and silently changes which lines run. Branch with labels.
rem    3. The line that runs the updater is the last line cmd ever reads from
rem       this file. See the note above it.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "dist\index.html" goto :NoApp
if not exist "server\update.ps1" goto :NoUpdater

where powershell >nul 2>nul
if errorlevel 1 goto :NoPowerShell

rem A file that arrived in a zip carries a "mark of the web", and PowerShell then
rem asks before running it even under -ExecutionPolicy Bypass. A -Command one-liner
rem is not a script file, so this is not gated and can clear the mark first.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0server' -Filter *.ps1 -ErrorAction SilentlyContinue ^| Unblock-File -ErrorAction SilentlyContinue" >nul 2>nul

echo.
echo   Updating T^&C Budget from GitHub...
echo.

rem ---------------------------------------------------------------------------
rem  THE LINE BELOW IS THE LAST LINE cmd MAY READ FROM THIS FILE.
rem  update.ps1 can replace Update.cmd while it is running. cmd reads a batch
rem  file by byte offset and would carry on at that offset inside the NEW file,
rem  running whatever text happened to land there. Chaining pause and exit onto
rem  the same line means the whole line is already in memory and cmd never goes
rem  back to the file. Do not add anything after it.
rem
rem  It deliberately passes NO -AppDir. %~dp0 ends in a backslash, so "%~dp0"
rem  hands Windows a trailing \" which the command-line parser reads as an
rem  ESCAPED QUOTE: the script then receives a path with a literal " in it and
rem  dies with "Illegal characters in path". update.ps1 works out the folder
rem  from its own location, which is always right. Do not pass "%~dp0" as an
rem  argument value here or in any other script.
rem ---------------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\update.ps1" & pause & exit /b

rem ---------------------------------------------------------------------------
:NoApp
echo.
echo   This is not the application folder: dist\index.html is missing.
echo   Put Update.cmd next to start.cmd and run it from there.
goto :End

rem ---------------------------------------------------------------------------
:NoUpdater
echo.
echo   server\update.ps1 is missing, so there is nothing to run.
echo   This copy of the folder predates the updater. Download the folder once
echo   more from GitHub, and from then on Update.cmd keeps it current.
goto :End

rem ---------------------------------------------------------------------------
:NoPowerShell
echo.
echo   Windows PowerShell was not found, so the folder cannot update itself.
echo   Download the folder from GitHub and copy dist, standalone and server
echo   over the top of this one by hand. Your data is untouched either way.
goto :End

rem ---------------------------------------------------------------------------
:End
echo.
pause
endlocal
