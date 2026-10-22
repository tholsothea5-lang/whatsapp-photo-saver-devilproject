@echo off
REM --- WhatsApp Photo Saver - easy start (Windows) --------------------------------
REM Double-click this file. First run installs dependencies, then starts the app.

node -v >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed.
    echo Download and install Node.js 18 or newer from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies ^(first run only, may take a few minutes^)...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo npm install failed. Check the error above and try again.
        pause
        exit /b 1
    )
)

REM npm.cmd works even when npm .ps1 scripts are blocked by PowerShell policy.
call npm.cmd start
pause
