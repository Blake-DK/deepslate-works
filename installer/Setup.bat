@echo off
title Deepslate Works
rem Once, from the download: puts DeepslateWorks.ps1 in %LOCALAPPDATA%\DeepslateWorks, sets up the Play button and the
rem "Deepslate Works" shortcuts, then runs it. After that the zip is not needed again.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DeepslateWorks.ps1" -Setup
echo.
pause
