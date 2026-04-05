# OurHangout OpenClaw Connector

Minimal Raspberry Pi / OpenClaw-side connector package for OurHangout Pobi pairing.

This repository is intended for the OpenClaw device itself.
You do not need to clone the full `ourHangout-server` repository on the Raspberry Pi.

## 1. Requirements

- Node.js 20+
- npm
- OpenClaw running locally on the device

## 2. Install

```bash
git clone https://github.com/pdj14/ourHangout-openclaw-connector.git
cd ourHangout-openclaw-connector
npm install
cp .env.example .env
```

## 3. First pairing

In the OurHangout app:

1. Open a Pobi profile
2. Tap `Create pairing code`
3. Copy the pairing code

On the Raspberry Pi, edit `.env`:

```env
HUB_WS_URL=ws://wowjini0228.synology.me:7084/v1/openclaw/connector/ws
PAIRING_CODE=7H2K9P
CONNECTOR_ID=raspi-openclaw-1
CONNECTOR_DEVICE_NAME=Living Room Pi
CONNECTOR_MODE=http
OPENCLAW_LOCAL_BASE_URL=http://127.0.0.1:18888
CONNECTOR_AUTH_TOKEN=
CONNECTOR_AUTH_TOKEN_FILE=./connector-auth-token.txt
CONNECTOR_RECONNECT_MS=3000
CONNECTOR_REQUEST_TIMEOUT_MS=4000
```

Run:

```bash
npm run start
```

## 4. What happens on first run

1. The connector registers with the server using `PAIRING_CODE`
2. The server returns a `connectorAuthToken`
3. The connector stores that token in `connector-auth-token.txt`
4. The connector reconnects to the server with that token

## 5. After first run

Usually you no longer need `PAIRING_CODE`.

If `connector-auth-token.txt` exists, the connector reuses it automatically.

## 6. Re-pairing

Re-pair when:

- You want to attach the device to a different Pobi
- `connector-auth-token.txt` was deleted
- The server revoked the connector

Steps:

1. Create a new pairing code in the app
2. Delete `connector-auth-token.txt`
3. Put the new code into `.env`
4. Run `npm run start` again

## 7. Local OpenClaw check

Before starting the connector, make sure OpenClaw is responding locally:

```bash
curl -s http://127.0.0.1:18888/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"hello"}'
```

## 8. Summary

On the Raspberry Pi:

1. Clone this repository
2. `npm install`
3. Set `.env`
4. Paste the app pairing code
5. Run `npm run start`
