@echo off
echo ========================================
echo DMX Dashboard
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    echo This may take a few minutes on first run...
    echo.
    call npm install
    echo.
    echo Installing client dependencies...
    cd client
    call npm install
    cd ..
    echo.
)

:: Build the React app if build folder doesn't exist
if not exist "client\build" (
    echo Building client application...
    cd client
    call npm run build
    cd ..
    echo.
)

echo Starting server...
echo.
echo The application will be accessible at:
echo - Local: http://localhost:3001
echo.

:: Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    set IP=!IP:~1!
    echo - Network: http://!IP!:3001
)

echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

:: Set production environment
set NODE_ENV=production

:: Start the server
node server/server.js

pause
