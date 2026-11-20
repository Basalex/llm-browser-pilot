@echo off
setlocal
title LLM Browser Pilot - Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js is not installed or not in PATH.
    where winget >nul 2>nul
    if not errorlevel 1 (
        set /p INSTALL_NODE=Install Node.js LTS automatically via winget? [Y/N]: 
        if /I "%INSTALL_NODE%"=="Y" (
            winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
            echo Please close this window and run launch.cmd again after Node.js finishes installing.
            pause
            exit /b 0
        )
    )
    echo Opening https://nodejs.org/ ...
    start "" "https://nodejs.org/"
    pause
    exit /b 1
)

node -e "require('node:http').get('http://127.0.0.1:4399/api/health',{timeout:1000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
if errorlevel 1 (
    echo Starting LLM Browser Pilot CLI Bridge...
    start "LLM Browser Pilot Bridge" /min node "%~dp0bridge\server.js"
    timeout /t 2 /nobreak >nul
)

node "%~dp0bridge\launch-helper.js"
echo.
pause
