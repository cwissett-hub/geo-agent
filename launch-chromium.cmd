@echo off
REM Launch a standalone Chromium with Geo Meta Trainer pre-loaded.
REM Use this when your managed Chrome blocks "Load unpacked".
REM Uses the Chromium that Playwright installs (not Google Chrome, so corporate
REM Chrome policies do not apply). Install it once with:  npx playwright install chromium
REM The profile lives next to this script in .chromium-profile (git-ignored),
REM so logins, keys and the notebook persist between launches.

setlocal
set "EXT=%~dp0"
if "%EXT:~-1%"=="\" set "EXT=%EXT:~0,-1%"
set "PROFILE=%EXT%\.chromium-profile"

set "CHROME="
for /d %%D in ("%LOCALAPPDATA%\ms-playwright\chromium-*") do (
  if exist "%%D\chrome-win64\chrome.exe" set "CHROME=%%D\chrome-win64\chrome.exe"
  if exist "%%D\chrome-win\chrome.exe" set "CHROME=%%D\chrome-win\chrome.exe"
)
if not defined CHROME (
  echo Playwright Chromium not found under %LOCALAPPDATA%\ms-playwright
  echo Run:  npx playwright install chromium
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "%CHROME%" --user-data-dir="%PROFILE%" --load-extension="%EXT%" --disable-extensions-except="%EXT%" --no-first-run --no-default-browser-check "https://www.geoguessr.com"
endlocal
