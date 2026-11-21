@echo off
cd /d "%~dp0"
if not exist "node_modules\.bin\esbuild.cmd" (
  call npm ci || exit /b 1
)
call npm run build || exit /b 1
echo Portfolio preview: http://127.0.0.1:8317/
python -m http.server 8317 --bind 127.0.0.1 --directory dist
pause
