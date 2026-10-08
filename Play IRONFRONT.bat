@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\IRONFRONT Zero Hour.exe" (
  start "" "release\win-unpacked\IRONFRONT Zero Hour.exe"
  exit /b 0
)
where npm >nul 2>nul
if errorlevel 1 (
  echo The packaged game is not available. Install Node.js to run from source,
  echo or use the complete win-unpacked release folder.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if errorlevel 1 (
  echo Could not install game dependencies.
  pause
  exit /b 1
)
call npm run game
if errorlevel 1 pause
