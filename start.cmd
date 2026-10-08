@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Can cai Node.js 22 hoac moi hon de chay tool.
  pause
  exit /b 1
)
node src/server.mjs --open
pause
