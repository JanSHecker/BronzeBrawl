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
  set "PYTHON=python"
) else (
  set "PYTHON=py -3"
)
if /i "%~1"=="--plain" goto plain
if /i "%~1"=="--web" goto plain
if not exist ".venv\Scripts\python.exe" (
  %PYTHON% -m venv .venv
  if errorlevel 1 goto failed
)
.venv\Scripts\python.exe -c "import textual; assert textual.__version__ == '1.0.0'" >nul 2>&1
if errorlevel 1 (
  echo Terminal-Oberflaeche wird eingerichtet. Internet wird beim ersten Start benoetigt.
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  if errorlevel 1 goto failed
)
.venv\Scripts\python.exe companion.py %*
goto finished

:plain
%PYTHON% companion.py %*

:finished
if not errorlevel 1 exit /b 0
:failed
echo.
echo Companion stopped with an error.
echo Ohne Zusatzpakete: start.cmd --plain
pause
exit /b 1
