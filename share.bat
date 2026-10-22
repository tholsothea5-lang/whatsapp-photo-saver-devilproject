@echo off
setlocal EnableExtensions
title WhatsApp Photo Saver - share on the internet
echo ============================================================
echo    WhatsApp Photo Saver - share with coworkers anywhere
echo ============================================================
echo    This opens your app to the internet through a free
echo    Cloudflare tunnel. IT sees a normal HTTPS site; nothing
echo    is installed system-wide (cloudflared.exe lives next to
echo    this file) and you can stop sharing by closing this.
echo.
echo    NOTE: set a password in config.json ("password": "...") first,
echo    or ANYONE with the link can control the app.
echo ============================================================
echo.

cd /d "%~dp0"

rem ---------- 1. The app should already be running ----------
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 5; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [!] The app is not running on http://localhost:3000 yet.
    echo     Run start.bat first, let it open, then run share.bat again.
    pause
    exit /b 1
)
echo [1/3] App is running.

rem ---------- 2. Get cloudflared (portable, no admin) ----------
if not exist "tools" mkdir "tools"
if not exist "tools\cloudflared.exe" (
    echo [2/3] Downloading the tunnel helper ^(first run only^)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'tools\cloudflared.exe' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
    if errorlevel 1 (
        echo       Download failed - check your internet connection and try again.
        pause
        exit /b 1
    )
) else (
    echo [2/3] Tunnel helper already here.
)

rem ---------- 3. Open the tunnel ----------
echo [3/3] Opening the tunnel... watch for your share link below:
echo.
echo       -------------------------------------------------------------------
echo       ^|  SHARE LINK will appear as ^"https://....trycloudflare.com^"  ^|
echo       -------------------------------------------------------------------
echo.
echo       Scope note: the link changes every time you run share.bat.
echo       Keep this window open while you want to share.
echo.

tools\cloudflared.exe tunnel --url http://localhost:3000

echo.
echo Tunnel closed - the share link is no longer reachable.
pause
