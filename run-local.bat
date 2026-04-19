@echo off
set PORT=3017
set NODE_EXE=C:\Users\Sarta\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe

if not exist "%NODE_EXE%" (
  echo Node runtime tidak ditemukan di:
  echo %NODE_EXE%
  pause
  exit /b 1
)

cd /d C:\laragon\www\daas-v3
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo Port %PORT% sedang dipakai oleh PID %%P.
  echo Jalankan stop-local.bat dulu, lalu ulangi run-local.bat
  exit /b 1
)

echo Menjalankan DaaS Local Docs di http://localhost:%PORT%
"%NODE_EXE%" server.js
