@echo off
echo ========================================
echo DMX Dashboard - Development Mode
echo ========================================
echo.

:: Check dependencies
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    call npm install
    cd ..
)

echo.
echo Starting development servers...
echo - React dev server: http://localhost:3000
echo - API server: http://localhost:3001
echo.
echo Press Ctrl+C to stop both servers
echo.

call npm run dev
