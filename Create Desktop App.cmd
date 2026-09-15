@echo off
rem ---------------------------------------------------------------------------
rem  Makes T&C Budget behave like an installed application: its own window, its
rem  own taskbar button, no browser address bar, no server, no PowerShell script.
rem
rem  It creates a desktop shortcut that launches Edge (or Chrome) in "app mode"
rem  pointed at standalone\index.html. Chromium reports that window as display
rem  mode "standalone", the same as an installed PWA, so it looks and behaves
rem  like one.
rem
rem  Run this once. Then right-click the new desktop icon and Pin to taskbar.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "PAGE=%APPDIR%\standalone\index.html"

if not exist "%PAGE%" (
  echo.
  echo   Could not find "%PAGE%".
  echo   Copy the whole folder from the repository, not just this file.
  echo.
  pause
  exit /b 1
)

rem  %ProgramFiles(x86)% contains a closing bracket, which would end a for(...)
rem  or if(...) block early. Resolve both roots into plain variables first.
set "PFX=%ProgramFiles(x86)%"
set "PFN=%ProgramFiles%"

rem --- Find a Chromium browser. Edge first: it is on every corporate build. ----
set "BROWSER="
for %%P in (
  "!PFX!\Microsoft\Edge\Application\msedge.exe"
  "!PFN!\Microsoft\Edge\Application\msedge.exe"
  "!LocalAppData!\Microsoft\Edge\Application\msedge.exe"
  "!PFX!\Google\Chrome\Application\chrome.exe"
  "!PFN!\Google\Chrome\Application\chrome.exe"
  "!LocalAppData!\Google\Chrome\Application\chrome.exe"
) do if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"

if not defined BROWSER (
  echo.
  echo   Neither Microsoft Edge nor Google Chrome was found in the usual places.
  echo   The app needs one of them. See docs\INSTALL.md for the manual steps.
  echo.
  pause
  exit /b 1
)

rem --- Icon for the shortcut, with the browser's own icon as a last resort ----
set "ICON=%APPDIR%\public\icon.ico"
if not exist "%ICON%" set "ICON=%APPDIR%\dist\icon.ico"
if not exist "%ICON%" set "ICON=%BROWSER%"

rem --- Build the file:// URL. Backslashes become forward slashes. -------------
set "P=%PAGE:\=/%"
set "URL=file:///%P%"

echo.
echo   Browser : %BROWSER%
echo   Page    : %PAGE%
echo.
echo   Creating the desktop shortcut...

rem --- Attempt 1: PowerShell -Command. ----------------------------------------
rem  Execution policy governs script FILES (.ps1). A -Command one-liner is not a
rem  script file, so this still works on machines where serve.ps1 is blocked.
rem  [char]34 supplies the quotes, so no nested double quotes reach cmd.
set "MADE="
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $d=[Environment]::GetFolderPath('Desktop'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $d 'TC Budget.lnk')); $s.TargetPath='%BROWSER%'; $s.Arguments='--app=' + [char]34 + '%URL%' + [char]34; $s.IconLocation='%ICON%'; $s.WorkingDirectory='%APPDIR%'; $s.Description='T and C Budget and S-Curve'; $s.Save()" 2>nul && set "MADE=1"

rem --- Attempt 2: Windows Script Host, if PowerShell is locked down. -----------
if not defined MADE (
  echo   PowerShell would not do it. Trying Windows Script Host...
  set "VBS=%TEMP%\tcbudget_shortcut.vbs"
  > "!VBS!" echo Set w = CreateObject("WScript.Shell")
  >>"!VBS!" echo Set s = w.CreateShortcut(w.SpecialFolders("Desktop") ^& "\TC Budget.lnk")
  >>"!VBS!" echo s.TargetPath = "%BROWSER%"
  >>"!VBS!" echo s.Arguments = "--app=" ^& Chr(34) ^& "%URL%" ^& Chr(34)
  >>"!VBS!" echo s.IconLocation = "%ICON%"
  >>"!VBS!" echo s.WorkingDirectory = "%APPDIR%"
  >>"!VBS!" echo s.Description = "T and C Budget and S-Curve"
  >>"!VBS!" echo s.Save
  cscript //nologo "!VBS!" 2>nul && set "MADE=1"
  del "!VBS!" 2>nul
)

rem --- Always leave the exact command on disk, whichever route was taken ------
> "%APPDIR%\taskbar-shortcut-target.txt" echo "%BROWSER%" --app="%URL%"

echo.
if defined MADE (
  echo   Done. There is now a "TC Budget" icon on your desktop.
  echo.
  echo   To put it on the taskbar:
  echo     right-click the icon  -^>  Show more options  -^>  Pin to taskbar
  echo.
  echo   Opening it now so you can check it...
  start "" "%BROWSER%" --app="%URL%"
) else (
  echo   Both automatic methods were blocked by policy on this machine.
  echo   Make the shortcut by hand, it takes about a minute:
  echo.
  echo     1. Right-click the desktop  -^>  New  -^>  Shortcut
  echo     2. Paste exactly this as the location, quotes included:
  echo.
  echo        "%BROWSER%" --app="%URL%"
  echo.
  echo     3. Next  -^>  name it  TC Budget  -^>  Finish
  echo     4. Right-click it  -^>  Properties  -^>  Change Icon  -^>  Browse
  echo        and pick:  %ICON%
  echo     5. Right-click it  -^>  Show more options  -^>  Pin to taskbar
  echo.
  echo   That command line is also saved in taskbar-shortcut-target.txt next to
  echo   this file, so you can copy it rather than retype it.
)
echo.
pause
endlocal
