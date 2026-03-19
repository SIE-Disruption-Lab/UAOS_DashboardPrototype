@echo off
echo Starting UAOS Dashboard...
cd /d "%~dp0"

where python >nul 2>&1 || (echo Python not found on PATH & pause & exit /b 1)

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing / updating dependencies...
pip install -r requirements.txt -q

echo.
echo ============================================================
echo  UAOS Dashboard running at http://localhost:8000
echo  Press Ctrl+C to stop.
echo ============================================================
echo.

cd backend
start "" "http://localhost:8000"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
