@echo off
rem JNU notice manual update: crawl on this PC (Korean IP) and push to GitHub.
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
py -m pip install -q -r requirements.txt
py scripts\update.py
echo.
pause
