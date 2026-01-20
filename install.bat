@echo off
echo ========================================
echo DMX Dashboard - Installation
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo.
    echo Please install Node.js (LTS version recommended)
    echo Download from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

echo Installing server dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install server dependencies!
    pause
    exit /b 1
)

echo.
echo Installing client dependencies...
cd client
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install client dependencies!
    cd ..
    pause
    exit /b 1
)

echo.
echo Building client application...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to build client application!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo Installation complete!
echo ========================================
echo.
echo To start the application, run: start.bat
echo.
pause
