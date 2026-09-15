@echo off
rem ---------------------------------------------------------------------------
rem  Makes T&C Budget behave like an installed application: its own window, its
rem  own taskbar button, no browser address bar, no server.
rem
rem  It creates a desktop shortcut that launches Edge (or Chrome) in "app mode"
rem  pointed at standalone\index.html. Chromium reports that window as display
rem  mode "standalone", the same as an installed PWA.
rem
rem  Run this once. Then right-click the new desktop icon and Pin to taskbar.
rem
rem  SAFETY RULES FOR THIS FILE, learned the hard way:
rem    1. It never deletes anything. There is no del, erase, rd or rmdir here,
rem       and there must never be one. An earlier version used "del %VAR%" with
rem       a variable that turned out to be empty; cmd read that as the current
rem       directory and offered to wipe it.
rem    2. It never writes a temporary script.
rem    3. It uses no ( ) blocks. Inside a parenthesised block an unescaped ")"
rem       in an echo closes the block early, which is what made (1) possible.
rem       Every branch below is a goto or a call to a label instead.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"

rem %~dp0 always ends in a backslash, so nothing needs trimming.
set "APPDIR=%~dp0"
set "PAGE=%APPDIR%standalone\index.html"
set "TARGETFILE=%APPDIR%taskbar-shortcut-target.txt"

if not exist "%PAGE%" goto :NoPage

call :FindBrowser
if not defined BROWSER goto :NoBrowser

set "ICON=%APPDIR%public\icon.ico"
if not exist "%ICON%" set "ICON=%APPDIR%dist\icon.ico"
if not exist "%ICON%" set "ICON=%BROWSER%"

rem file:// wants forward slashes.
set "SLASHED=%PAGE:\=/%"
set "URL=file:///%SLASHED%"

echo.
echo   Browser : %BROWSER%
echo   Page    : %PAGE%
echo.

rem Write the command line out first, so it is available whatever happens next.
> "%TARGETFILE%" echo "%BROWSER%" --app="%URL%"

echo   Creating the desktop shortcut...

rem Execution policy governs script FILES. A -Command one-liner is not a script
rem file, so this still works where serve.ps1 is blocked. [char]34 supplies the
rem quotes so no nested double quotes have to survive cmd's parser.
set "MADE="
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $d=[Environment]::GetFolderPath('Desktop'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $d 'TC Budget.lnk')); $s.TargetPath='%BROWSER%'; $s.Arguments='--app=' + [char]34 + '%URL%' + [char]34; $s.IconLocation='%ICON%'; $s.WorkingDirectory='%APPDIR%'; $s.Description='T and C Budget and S-Curve'; $s.Save()" >nul 2>nul
if not errorlevel 1 set "MADE=1"

if defined MADE goto :Made
goto :Manual

rem ---------------------------------------------------------------------------
:Made
echo.
echo   Done. There is now a "TC Budget" icon on your desktop.
echo.
echo   To put it on the taskbar:
echo     right-click the icon, then Show more options, then Pin to taskbar
echo.
echo   Opening it now so you can check it...
start "" "%BROWSER%" --app="%URL%"
goto :End

rem ---------------------------------------------------------------------------
:Manual
echo.
echo   PowerShell would not create the shortcut on this machine, most likely
echo   because policy restricts it. Make the shortcut by hand instead, it takes
echo   about a minute:
echo.
echo     1. Right-click the desktop, then New, then Shortcut
echo     2. Paste this as the location, quotes included:
echo.
echo        "%BROWSER%" --app="%URL%"
echo.
echo     3. Next, name it  TC Budget, then Finish
echo     4. Right-click it, Properties, Change Icon, Browse, and pick:
echo        %ICON%
echo     5. Right-click it, Show more options, Pin to taskbar
echo.
echo   That command line is also saved next to this file in:
echo     %TARGETFILE%
goto :End

rem ---------------------------------------------------------------------------
:NoPage
echo.
echo   Could not find:
echo     %PAGE%
echo.
echo   Copy the whole folder from the repository, not just this file.
goto :End

rem ---------------------------------------------------------------------------
:NoBrowser
echo.
echo   Neither Microsoft Edge nor Google Chrome was found in the usual places.
echo   The app needs one of them. See docs\INSTALL.md for the manual steps.
goto :End

rem ---------------------------------------------------------------------------
rem  %ProgramFiles(x86)% carries a closing bracket, so it is resolved into a
rem  plain variable before being used anywhere a bracket could matter.
:FindBrowser
set "BROWSER="
set "PFX=%ProgramFiles(x86)%"
set "PFN=%ProgramFiles%"
call :TryBrowser "%PFX%\Microsoft\Edge\Application\msedge.exe"
call :TryBrowser "%PFN%\Microsoft\Edge\Application\msedge.exe"
call :TryBrowser "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
call :TryBrowser "%PFX%\Google\Chrome\Application\chrome.exe"
call :TryBrowser "%PFN%\Google\Chrome\Application\chrome.exe"
call :TryBrowser "%LocalAppData%\Google\Chrome\Application\chrome.exe"
exit /b

:TryBrowser
if defined BROWSER exit /b
if not exist "%~1" exit /b
set "BROWSER=%~1"
exit /b

rem ---------------------------------------------------------------------------
:End
echo.
pause
endlocal
