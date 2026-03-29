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

if not defined GEMINI_API_KEY (
  echo GEMINI_API_KEY is not set.
  echo Create local-secrets.cmd from local-secrets.example.cmd and try again.
  pause
  exit /b 1
)

if not defined GOOGLE_CLOUD_PROJECT (
  set "GOOGLE_CLOUD_PROJECT=gen-lang-client-0743317859"
)

set "MOCK_AI=false"

where gcloud >nul 2>nul
if errorlevel 1 (
  echo gcloud was not found on this machine.
  echo Continuing anyway. Music generation can still work with GEMINI_API_KEY.
  echo If Google Cloud ADC is not configured, lyric alignment will fall back to proportional timings.
) else (
  echo Checking Google Cloud Application Default Credentials...
  gcloud auth application-default print-access-token >nul 2>nul
  if errorlevel 1 (
    echo No ADC login found. Opening Google browser login now...
    gcloud auth application-default login
    if errorlevel 1 (
      echo Google Cloud ADC login failed.
      echo Continuing anyway. Alignment may fall back if credentials are unavailable.
    )
  )

  echo Setting Google Cloud project...
  gcloud config set project "%GOOGLE_CLOUD_PROJECT%" >nul
  gcloud auth application-default set-quota-project "%GOOGLE_CLOUD_PROJECT%" >nul
)

echo Starting LAN Lyric Imposter server in real AI mode...
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
