@echo off
title Deepslate Works - update and play
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Play
if errorlevel 1 pause
