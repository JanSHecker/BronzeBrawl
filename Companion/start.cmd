@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  echo Python 3.11 or newer was not found.
  echo Install Python from https://www.python.org/downloads/windows/ and enable the py launcher.
  pause
  exit /b 1
)
py -3.11 companion.py
if errorlevel 1 (
  echo.
  echo Companion stopped with an error.
  pause
)
