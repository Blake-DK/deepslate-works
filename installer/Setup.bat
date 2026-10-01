@echo off
title Deepslate Works
rem Once, from the download: puts DeepslateWorks.ps1 in %LOCALAPPDATA%\DeepslateWorks and opens the Deepslate Works
rem window, which asks before each thing it does. After that the zip is not needed again.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DeepslateWorks.ps1" -Setup
if errorlevel 1 (
  echo.
  pause
)
