@echo off
title Interactive Lesson Builder
cd /d "%~dp0"

REM If the app is already running, just open the browser and exit.
powershell -NoProfile -Command "try{ (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:3000')>$null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Interactive Lesson Builder is already running. Opening browser...
  start "" http://localhost:3000
  exit /b
)

echo ============================================================
echo   Interactive Lesson Builder
echo   Starting the local app - your browser opens when ready.
echo   Keep this window open while you work.
echo   Close this window to stop the app.
echo ============================================================
echo.

REM Wait for the dev server to answer, then open the browser (runs in background).
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){ try{ (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:3000')>$null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Milliseconds 750 } }"

call npm run dev
