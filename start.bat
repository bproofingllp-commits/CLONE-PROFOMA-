@echo off
title Busy Accounting Server
color 0B
echo ============================================
echo    Busy Accounting Pro - Real-Time Server
echo ============================================
echo.
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)
echo Starting server...
start /MIN cmd /c "node server.js"

:: Wait for server
ping 127.0.0.1 -n 4 > nul

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R "IPv4.*:"') do set IP=%%a
set IP=%IP: =%
echo.
echo   Server Running at:
echo   Local:   http://localhost:3000
echo   Network: http://%IP%:3000
echo.
echo   Share the Network URL with other PCs
echo   to access the same data in real-time.
echo.
echo   Default login: admin / admin123
echo.
echo ============================================
echo Opening browser...
start http://localhost:3000
echo.
echo To stop: double-click stop.bat
echo ============================================
pause
