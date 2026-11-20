@echo off
title Stop LLM Browser Pilot Bridge
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'bridge[\\/]server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped bridge PID ' + $_.ProcessId) }"
