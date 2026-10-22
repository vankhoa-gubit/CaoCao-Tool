@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 22.13 tro len truoc khi cai ket noi Cao Cao.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)"
if errorlevel 1 (
  echo Can Node.js 22.13 tro len. Hay cap nhat Node.js va thu lai.
  pause
  exit /b 1
)
if not exist node_modules\playwright\package.json (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts\build-extension.mjs
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-extension.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0extension"
echo Mo chrome://extensions hoac edge://extensions, bat Developer mode,
echo chon Load unpacked va chon thu muc extension vua mo.
pause
