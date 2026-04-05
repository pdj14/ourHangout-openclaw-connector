#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR="$SCRIPT_DIR"
ENV_FILE="$REPO_DIR/.env"
ENV_EXAMPLE="$REPO_DIR/.env.example"
SERVICE_NAME="ourhangout-openclaw-connector"
SERVICE_TEMPLATE="$REPO_DIR/deploy/${SERVICE_NAME}.service"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"
TOKEN_FILE="$REPO_DIR/connector-auth-token.txt"
PAIRING_CODE="${1:-}"
INSTALL_USER=$(id -un)
TMP_LOG="$REPO_DIR/.install-service.log"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  echo "sudo is required for systemd installation." >&2
  exit 1
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"
}

clear_pairing_code_in_env() {
  if grep -q '^PAIRING_CODE=' "$ENV_FILE"; then
    sed -i 's|^PAIRING_CODE=.*$|PAIRING_CODE=|' "$ENV_FILE"
  else
    printf '\nPAIRING_CODE=\n' >> "$ENV_FILE"
  fi
}

render_service_file() {
  tmp_file=$(mktemp)
  sed \
    -e "s|^User=.*$|User=$INSTALL_USER|" \
    -e "s|^WorkingDirectory=.*$|WorkingDirectory=$REPO_DIR|" \
    "$SERVICE_TEMPLATE" > "$tmp_file"

  run_root cp "$tmp_file" "$SERVICE_TARGET"
  rm -f "$tmp_file"
}

register_once_with_pairing() {
  if [ -s "$TOKEN_FILE" ]; then
    echo "[install-service] Existing connector token found. Skipping pairing registration."
    return
  fi

  if [ -z "$PAIRING_CODE" ]; then
    printf 'Enter pairing code from the app: '
    read -r PAIRING_CODE
  fi

  PAIRING_CODE=$(printf '%s' "$PAIRING_CODE" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')
  if [ -z "$PAIRING_CODE" ]; then
    echo "[install-service] Pairing code is required on first install." >&2
    exit 1
  fi

  rm -f "$TMP_LOG"
  echo "[install-service] Registering connector with pairing code..."
  npm run start -- "$PAIRING_CODE" >"$TMP_LOG" 2>&1 &
  bg_pid=$!

  elapsed=0
  while [ "$elapsed" -lt 45 ]; do
    if [ -s "$TOKEN_FILE" ]; then
      echo "[install-service] Connector token created."
      kill "$bg_pid" >/dev/null 2>&1 || true
      wait "$bg_pid" >/dev/null 2>&1 || true
      clear_pairing_code_in_env
      return
    fi

    if ! kill -0 "$bg_pid" >/dev/null 2>&1; then
      echo "[install-service] Connector process exited before token creation." >&2
      cat "$TMP_LOG" >&2 || true
      exit 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "[install-service] Timed out waiting for connector token creation." >&2
  kill "$bg_pid" >/dev/null 2>&1 || true
  wait "$bg_pid" >/dev/null 2>&1 || true
  cat "$TMP_LOG" >&2 || true
  exit 1
}

main() {
  cd "$REPO_DIR"
  ensure_env_file

  echo "[install-service] Installing npm dependencies..."
  npm install

  register_once_with_pairing

  echo "[install-service] Installing systemd service..."
  render_service_file
  run_root systemctl daemon-reload
  run_root systemctl enable --now "$SERVICE_NAME"

  echo "[install-service] Service installed and started."
  echo
  run_root systemctl --no-pager --full status "$SERVICE_NAME" || true
}

main "$@"
