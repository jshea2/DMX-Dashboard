@echo off
echo ========================================
echo DMX Dashboard - Installation Verification
echo ========================================
echo.

set ERRORS=0

:: Check Node.js
echo [1/6] Checking Node.js installation...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [FAIL] Node.js is not installed
    set /a ERRORS+=1
) else (
    node --version
    echo [PASS] Node.js found
)
echo.

:: Check npm
echo [2/6] Checking npm installation...
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [FAIL] npm is not installed
    set /a ERRORS+=1
) else (
    npm --version
    echo [PASS] npm found
)
echo.

:: Check server dependencies
echo [3/6] Checking server dependencies...
if exist "node_modules" (
    echo [PASS] Server dependencies installed
) else (
    echo [FAIL] Server dependencies not found - run install.bat
    set /a ERRORS+=1
)
echo.

:: Check client dependencies
echo [4/6] Checking client dependencies...
if exist "client\node_modules" (
    echo [PASS] Client dependencies installed
) else (
    echo [FAIL] Client dependencies not found - run install.bat
    set /a ERRORS+=1
)
echo.

:: Check client build
echo [5/6] Checking client build...
if exist "client\build" (
    echo [PASS] Client build found
) else (
    echo [WARN] Client build not found - will be created on first run
)
echo.

:: Check server files
echo [6/6] Checking server files...
if exist "server\server.js" (
    if exist "server\config.js" (
        if exist "server\state.js" (
            if exist "server\dmxEngine.js" (
                if exist "server\outputEngine.js" (
                    echo [PASS] All server files present
                ) else (
                    echo [FAIL] Missing server/outputEngine.js
                    set /a ERRORS+=1
                )
            ) else (
                echo [FAIL] Missing server/dmxEngine.js
                set /a ERRORS+=1
            )
        ) else (
            echo [FAIL] Missing server/state.js
            set /a ERRORS+=1
        )
    ) else (
        echo [FAIL] Missing server/config.js
        set /a ERRORS+=1
    )
) else (
    echo [FAIL] Missing server/server.js
    set /a ERRORS+=1
)
echo.

:: Summary
echo ========================================
if %ERRORS%==0 (
    echo [SUCCESS] All checks passed!
    echo.
    echo You can now run start.bat to start the application.
) else (
    echo [ERRORS FOUND] %ERRORS% check(s) failed
    echo.
    echo Please run install.bat to fix installation issues.
)
echo ========================================
echo.

pause
