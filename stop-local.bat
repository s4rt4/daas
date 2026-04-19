@echo off
set PORT=3017
set FOUND=0

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  set FOUND=1
  echo Menghentikan PID %%P di port %PORT%...
  taskkill /PID %%P /F
)

if "%FOUND%"=="0" (
  echo Tidak ada proses yang sedang listen di port %PORT%.
)
