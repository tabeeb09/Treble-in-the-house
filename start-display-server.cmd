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

rem Always force mock mode in the simple launcher.
set "MOCK_AI=true"
set "GEMINI_API_KEY="
set "GOOGLE_APPLICATION_CREDENTIALS="
set "GOOGLE_CLOUD_PROJECT="
set "LYRIA_MODEL=lyria-3-pro-preview"
set "MUSIC_PROVIDER=google-lyria"
set "ALIGNMENT_PROVIDER=google-cloud-stt"

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
