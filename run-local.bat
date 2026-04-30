@echo off
set PORT=3017
set APP_URL=http://localhost:%PORT%/app
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
  echo Membuka app di browser...
  start "" "%APP_URL%"
  exit /b 0
)

echo Menjalankan DaaS Local Docs di %APP_URL%
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%APP_URL%'"
"%NODE_EXE%" server.js
