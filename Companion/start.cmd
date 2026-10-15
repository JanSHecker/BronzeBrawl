@echo off
title BronzeBrawl Companion
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python 3.11 oder neuer fehlt. Bitte Python installieren.
    pause
    exit /b 1
  )
  python companion.py
) else (
  py -3 companion.py
)
if errorlevel 1 (
  echo.
  echo Companion stopped with an error.
  pause
)
