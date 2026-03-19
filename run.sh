#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v python3 &>/dev/null; then
  echo "Python 3 not found on PATH" && exit 1
fi

if [ ! -d venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt -q

echo ""
echo "============================================================"
echo " UAOS Dashboard running at http://localhost:8000"
echo " Press Ctrl+C to stop."
echo "============================================================"
echo ""

cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
