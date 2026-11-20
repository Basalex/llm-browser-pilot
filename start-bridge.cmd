@echo off
title LLM Browser Pilot - Local CLI Bridge
cd /d "%~dp0"
echo Starting LLM Browser Pilot CLI Bridge on http://127.0.0.1:4399 ...
node bridge/server.js
pause
