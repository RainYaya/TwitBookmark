@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo First run: installing dependencies...
  call pnpm install
  if errorlevel 1 goto :error
)

if not exist dist\index.html (
  echo Building the web app...
  call pnpm build
  if errorlevel 1 goto :error
)

start "" http://localhost:4317
call pnpm start
goto :eof

:error
echo.
echo TwitBookmark failed to start.
pause
