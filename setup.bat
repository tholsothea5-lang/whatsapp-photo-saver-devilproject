@echo off
setlocal EnableExtensions
title WhatsApp Photo Saver setup
echo ============================================================
echo    WhatsApp Photo Saver - one-click setup
echo ============================================================
echo    This installs the app next to this file, keeps everything
echo    (your WhatsApp login, downloads, settings) on this PC.
echo ============================================================
echo.

cd /d "%~dp0"

rem ---------- 1. Check Node.js ----------
echo [1/4] Checking for Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo       Node.js is not installed.
    echo       Opening https://nodejs.org - install the LTS version,
    echo       then run setup.bat again.
    start "" https://nodejs.org/en/download
    pause
    exit /b 1
)
for /f "delims=" %%V in ('node -v') do set "NODEV=%%V"
echo       Node.js %NODEV% found.

set "APPDIR=%~dp0whatsapp-photo-saver"

rem ---------- 2. Download the app ----------
if exist "%APPDIR%\package.json" (
    echo [2/4] App already downloaded here - reusing it.
) else (
    echo [2/4] Downloading the app from GitHub...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/tholsothea5-lang/whatsapp-photo-saver-devilproject/archive/refs/heads/main.zip' -OutFile 'wps-main.zip' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
    if errorlevel 1 (
        echo       Download failed - check your internet connection and try again.
        pause
        exit /b 1
    )
    echo       Extracting...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath 'wps-main.zip' -DestinationPath 'wps-tmp' -Force; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
    if errorlevel 1 (
        echo       Extraction failed.
        pause
        exit /b 1
    )
    if exist "%APPDIR%" rmdir /s /q "%APPDIR%"
    move "wps-tmp\whatsapp-photo-saver-devilproject-main" "%APPDIR%" >nul
    if errorlevel 1 (
        echo       Could not move the extracted folder - see the files next to setup.bat.
        pause
        exit /b 1
    )
    rmdir /s /q "wps-tmp" 2>nul
    del "wps-main.zip" 2>nul
)

rem ---------- 3. Install dependencies ----------
pushd "%APPDIR%"
echo [3/4] Installing dependencies (first run only, a few minutes)...
call npm.cmd install
if errorlevel 1 (
    echo       npm install failed. Read the error above and try again.
    popd
    pause
    exit /b 1
)

rem ---------- 4. Start ----------
echo [4/4] Handing over to the Python web app...
echo       Your browser will open at http://localhost:3000 shortly.
echo       This window stays open while the app runs - keep it open,
echo       or close it (then press any key) to stop the app.
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:8000'"
call start-web.bat
popd
pause
