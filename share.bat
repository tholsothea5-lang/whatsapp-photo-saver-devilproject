@echo off
setlocal EnableExtensions
title WhatsApp Photo Saver - share on the internet

rem The Python main app listens on port 8000 (start-web.bat must be running).

echo ============================================================
echo    WhatsApp Photo Saver - share with coworkers anywhere
echo ============================================================
echo    This opens the Python web app (port 8000) to the internet
echo    through a free Cloudflare tunnel. Nothing is installed
echo    system-wide and you can stop sharing by closing this.
echo.
echo    SECURITY: set "password" in config.json first, or ANYONE
echo    with the link can control the app.
echo ============================================================
echo.

cd /d "%~dp0"

rem ---------- 1. The web app should already be running ----------
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/login' -UseBasicParsing -TimeoutSec 5; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto app_ok
echo [!] The web app is not running on http://127.0.0.1:8000 yet.
echo     Run start-web.bat first, let it open, then run share.bat again.
pause
exit /b 1
:app_ok
echo [1/3] Web app is running.

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
echo [3/3] Opening the tunnel... your SHARE LINK appears below as
echo       "https://<something>.trycloudflare.com"
echo       Note: the link changes every time you run share.bat.
echo       Keep this window open while you want the link alive.
echo.

tools\cloudflared.exe tunnel --url http://127.0.0.1:8000

echo.
echo Tunnel closed - the share link is no longer reachable.
pause
