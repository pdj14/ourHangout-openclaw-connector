#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR="$SCRIPT_DIR"
ENV_FILE="$REPO_DIR/.env"
ENV_EXAMPLE="$REPO_DIR/.env.example"
PAIRING_CODE="${1:-}"

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"
}

main() {
  cd "$REPO_DIR"
  ensure_env_file

  echo "[install-openclaw-channel] Installing npm dependencies..."
  npm install

  if [ -n "$PAIRING_CODE" ]; then
    echo "[install-openclaw-channel] Running channel setup with provided pairing code..."
    npm run channel:setup -- "$PAIRING_CODE"
  else
    echo "[install-openclaw-channel] Running channel setup..."
    npm run channel:setup
  fi

  echo
  echo "[install-openclaw-channel] Next:"
  echo "  1. Run: npm run channel:doctor"
  echo "  2. Fix any blocking items from the doctor output."
  echo "  3. Restart the OpenClaw gateway."
  echo "  4. Run: npm run channel:smoke"
}

main "$@"
