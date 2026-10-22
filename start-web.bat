@echo off
setlocal EnableExtensions
title WhatsApp Photo Saver (Python web app)
echo ============================================================
echo    WhatsApp Photo Saver - starting
echo ============================================================
echo    Starts the WhatsApp engine (background) and the Python
echo    web app at http://localhost:8000
echo    First run downloads and installs everything (no admin needed).
echo ============================================================
echo.

cd /d "%~dp0"

rem ---------- 1. Node engine ----------
echo [1/4] Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo       Node.js is not installed.
    echo       Opening https://nodejs.org - install the LTS version,
    echo       then run start-web.bat again.
    start "" https://nodejs.org/en/download
    pause
    exit /b 1
)
if not exist node_modules (
    echo       Installing engine dependencies ^(first run only, a few minutes^)...
    call npm.cmd install
    if errorlevel 1 (
        echo       npm install failed. Read the error above and try again.
        pause
        exit /b 1
    )
)
echo       Node engine ready.

rem ---------- 2. Python environment ----------
echo [2/4] Checking the Python environment...

if exist ".venv\Scripts\python.exe" goto python_ready

rem Preferred: portable Python via uv (no admin, works even without system Python)
if exist "tools\uv.exe" (
    echo       Creating portable Python environment ^(first run only^)...
    tools\uv.exe venv .venv --python 3.12
    if errorlevel 1 (
        echo       Could not create the Python environment.
        pause
        exit /b 1
    )
    tools\uv.exe pip install -r requirements.txt
    if errorlevel 1 (
        echo       Python dependency install failed.
        pause
        exit /b 1
    )
    goto python_ready
)

rem Fallback: system Python
python --version >nul 2>&1
if %errorlevel%==0 goto have_python
py --version >nul 2>&1
if %errorlevel%==0 goto have_py

echo       No Python yet. Downloading the portable helper ^(first run only^)...
echo       (This downloads a small command-line tool; nothing is installed system-wide.)
if not exist "tools" mkdir "tools"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile 'tools\uv.zip' -UseBasicParsing; Expand-Archive -LiteralPath 'tools\uv.zip' -DestinationPath 'tools\uvtmp' -Force; Move-Item 'tools\uvtmp\uv.exe' 'tools\uv.exe' -Force; Remove-Item 'tools\uvtmp','tools\uv.zip' -Recurse -Force; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo       Download failed - check your internet connection and try again.
    echo       (Alternatively install Python 3.10+ from python.org and re-run.)
    pause
    exit /b 1
)
echo       Creating portable Python environment...
tools\uv.exe venv .venv --python 3.12
if errorlevel 1 (
    echo       Could not create the Python environment.
    pause
    exit /b 1
)
tools\uv.exe pip install -r requirements.txt
goto python_ready

:have_py
if not exist .venv\Scripts\python.exe (
    py -3 -m venv .venv
    ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)
goto python_ready

:have_python
if not exist .venv\Scripts\python.exe (
    python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)
goto python_ready

:python_ready
echo       Python environment ready.

rem ---------- 3/4. Start ----------
echo [3/4] Starting the WhatsApp engine in the background...
start "WhatsApp engine (see HTTPS logs here)" /min cmd /c "call npm.cmd start"

powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/status' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { exit 0 }" >nul 2>&1

echo [4/4] Starting the Python web app on http://localhost:8000 ...
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 6; Start-Process 'http://localhost:8000'"
".venv\Scripts\python.exe" app.py

echo.
echo Web app stopped.
pause
