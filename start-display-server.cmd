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

rem If no local secrets were provided, fall back to mock mode.
if not defined MOCK_AI set "MOCK_AI=true"
if not defined LYRIA_MODEL set "LYRIA_MODEL=lyria-3-pro-preview"
if not defined MUSIC_PROVIDER set "MUSIC_PROVIDER=google-lyria"
if not defined ALIGNMENT_PROVIDER set "ALIGNMENT_PROVIDER=google-cloud-stt"

echo Starting LAN Lyric Imposter server...
start "LAN Lyric Imposter Server" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo Waiting for the server to boot...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(30); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -Uri 'http://localhost:3000/display' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 750 }; exit 1"
if errorlevel 1 (
  echo The server did not become ready in time.
  echo If a new server window opened, check it for errors and refresh the browser after it finishes booting.
  pause
  exit /b 1
)

echo Opening display page in your default browser...
start "" "http://localhost:3000/display"

endlocal
