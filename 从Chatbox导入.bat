@echo off
chcp 65001 >nul
cd /d "%~dp0"
cls
type "%~dp0usage-chatbox.txt"
echo.
echo ------------------------------------------------------------
if "%~1"=="" echo [!] No arguments: importing ALL knowledge bases. This may take minutes.
if "%~1"=="" echo     Press Ctrl+C now if you want to check the list first.
echo [run] python chatbox-import.py %*
echo ------------------------------------------------------------
echo.
python "chatbox-import.py" %*
if errorlevel 9009 py -3 "chatbox-import.py" %*
echo.
echo ------------------------------------------------------------
echo Done. Press any key to close.
pause >nul
