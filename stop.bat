@echo off
echo Stopping Busy Accounting Server...
taskkill /F /IM node.exe >nul 2>&1
echo Server stopped.
echo.
pause
