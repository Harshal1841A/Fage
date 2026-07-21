#!/usr/bin/env bash
# ============================================================================
# FAGE Master — One-Click Startup (Linux / macOS)
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"


BACKEND_PORT=8000
FRONTEND_PORT=3000

echo ""
echo "  ============================================"
echo "   FAGE: Fraud Analytics & Governance Engine"
echo "   Master Build — One-Click Startup"
echo "  ============================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 not found. Please install Python 3.10+."
    exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found. Please install Node.js 18+."
    exit 1
fi

echo "[1/5] Setting up Python virtual environment..."
if [ ! -d "backend/venv" ]; then
    python3 -m venv backend/venv
fi

echo "[2/5] Installing backend dependencies..."
backend/venv/bin/pip install --upgrade pip -q
backend/venv/bin/pip install -r backend/requirements.txt -q

echo "[3/5] Installing frontend dependencies..."
npm install --prefix frontend -q

echo "[4/5] Training models (if not already present)..."
if [ ! -f "backend/models/xgboost_classifier.pkl" ]; then
    echo "        Models not found. Training now — this may take 2-3 minutes..."
    (cd backend && venv/bin/python train_models.py)
else
    echo "        Models already trained. Skipping."
fi

echo "[5/5] Starting servers..."
echo ""
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo ""

# Start backend in background
(cd backend && venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND_PORT} --reload &)
BACKEND_PID=$!

# Start frontend in background
(cd frontend && npm run dev &)
FRONTEND_PID=$!

echo ""
echo "  Both servers are starting. Press Ctrl+C to stop both."
echo "  Open http://localhost:${FRONTEND_PORT} in your browser."
echo ""

# Wait for interrupt
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
