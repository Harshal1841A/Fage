REM ============================================================================
REM FAGE Master — One-Click Startup (Windows)
REM ============================================================================
@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   FAGE: Fraud Analytics ^& Governance Engine
echo   Master Build — One-Click Startup
echo  ============================================
echo.

set BACKEND_PORT=8000
set FRONTEND_PORT=3000

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+.
    exit /b 1
)

REM Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+.
    exit /b 1
)

echo [1/5] Setting up Python virtual environment...
if not exist "backend\venv" (
    python -m venv backend\venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        exit /b 1
    )
)

echo [2/5] Installing backend dependencies...
backend\venv\Scripts\python.exe -m pip install --upgrade pip >nul
backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt >nul 2>&1
if errorlevel 1 (
    echo [WARN] Some pip packages may have failed — check output above.
)

echo [3/5] Installing frontend dependencies...
call npm install --prefix frontend >nul 2>&1
if errorlevel 1 (
    echo [WARN] npm install had issues — check output above.
)

echo [4/5] Training models (if not already present)...
if not exist "backend\models\xgboost_classifier.pkl" (
    echo         Models not found. Training now — this may take 2-3 minutes...
    cd backend
    venv\Scripts\python.exe train_models.py
    cd ..
) else (
    echo         Models already trained. Skipping.
)

echo [5/5] Starting servers...
echo.
echo  Backend will run on: http://localhost:%BACKEND_PORT%
echo  Frontend will run on: http://localhost:%FRONTEND_PORT%
echo.
echo  Press Ctrl+C in each window to stop.
echo.

REM Start backend in a new window
start "FAGE Backend" cmd /k "cd backend && set FAGE_ENV=development && venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload"

REM Start frontend in a new window
start "FAGE Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo  Both servers are starting. Open http://localhost:%FRONTEND_PORT% in your browser.
echo.

pause
