@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on this machine.
  echo Please install Node.js and npm first, then try again.
  pause
  exit /b 1
)

if exist "local-secrets.cmd" (
  call "local-secrets.cmd"
)

rem Default to mock mode so the game works out of the box when double-clicked.
if not defined MOCK_AI set "MOCK_AI=true"

rem Optional tracked template:
rem copy local-secrets.example.cmd to local-secrets.cmd and fill in your own values.

echo Starting LAN Lyric Imposter server...
start "LAN Lyric Imposter Server" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo Waiting for the server to boot...
timeout /t 5 /nobreak >nul

echo Opening display page in your default browser...
start "" "http://localhost:3000/display"

endlocal
