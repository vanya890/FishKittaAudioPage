@echo off
setlocal
title Kitta Audio Console Portable

cd /d "%~dp0"

if not exist "%~dp0runtime\node.exe" (
  echo [ERROR] Portable Node.js runtime is missing.
  echo Extract the complete ZIP archive again. Do not run this file from inside the ZIP.
  pause
  exit /b 1
)

"%~dp0runtime\node.exe" --version
if errorlevel 1 (
  echo [ERROR] The bundled Node.js runtime cannot start on this computer.
  pause
  exit /b 1
)

echo.
echo Starting Kitta Audio Console...
echo A browser tab will open automatically.
echo Keep this window open while using the application.
echo Press Ctrl+C here to stop the local server.
echo.

"%~dp0runtime\node.exe" "%~dp0local-server.mjs"

if errorlevel 1 (
  echo.
  echo [ERROR] The local server stopped unexpectedly.
  pause
)
