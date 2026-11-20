@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-devkit.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Setup failed. See the error above.
) else (
  echo.
  echo Setup is complete. Run Start DevKit.bat to open the developer menu.
)
pause
exit /b %RESULT%\n