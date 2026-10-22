#!/usr/bin/env sh
# --- WhatsApp Photo Saver - easy start (macOS / Linux) --------------------------
# Run: sh start.sh   (first run installs dependencies, then starts the app)

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed."
    echo "Install Node.js 18 or newer from https://nodejs.org (or your package manager)"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies (first run only, may take a few minutes)..."
    npm install || exit 1
fi

npm start
