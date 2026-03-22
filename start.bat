@echo off
setlocal

set ROOT_DIR=%~dp0
set APP_PORT=2611

echo =========================================
echo  APIK Production Launcher
echo =========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js is required but was not found in PATH.
	exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
	echo npm is required but was not found in PATH.
	exit /b 1
)

if not exist "%ROOT_DIR%backend\node_modules" (
	echo [1/4] Installing backend dependencies...
	call npm --prefix "%ROOT_DIR%backend" install || exit /b 1
)

if not exist "%ROOT_DIR%frontend\node_modules" (
	echo [2/4] Installing frontend dependencies...
	call npm --prefix "%ROOT_DIR%frontend" install || exit /b 1
)

echo [3/4] Building production assets...
call npm run build || exit /b 1

echo [4/5] Checking existing process on port %APP_PORT%...
set EXISTING_PID=
for /f %%i in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)"') do set EXISTING_PID=%%i
if defined EXISTING_PID (
	echo Found process PID %EXISTING_PID% on port %APP_PORT%. Stopping it...
	powershell -NoProfile -Command "Stop-Process -Id %EXISTING_PID% -Force -ErrorAction SilentlyContinue"
	timeout /t 1 /nobreak >nul
) else (
	echo No process is listening on port %APP_PORT%.
)

echo [5/5] Starting production server on port %APP_PORT%...
set NODE_ENV=production
set PORT=%APP_PORT%
start "" "http://localhost:%APP_PORT%"
node "%ROOT_DIR%backend\dist\index.js"
