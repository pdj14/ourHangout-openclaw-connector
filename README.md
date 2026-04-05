# OurHangout OpenClaw Connector

This repository now contains both:

- the legacy websocket bridge connector (`connector.mjs`)
- the new `ourhangout` OpenClaw custom channel plugin under `extensions/ourhangout`

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

## 2.1 Custom channel plugin bootstrap

If you want to use the new custom channel path instead of the legacy bridge, set these in `.env`:

```env
OURHANGOUT_SERVER_BASE_URL=http://127.0.0.1:3000
OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw.json
OPENCLAW_CHANNEL_ACCOUNT_ALIAS=default
OPENCLAW_CHANNEL_PAIRING_CODE=7H2K9P
OPENCLAW_CHANNEL_DEVICE_KEY=raspi-openclaw-1
OPENCLAW_CHANNEL_DEVICE_NAME=Living Room Pi
OPENCLAW_CHANNEL_PLATFORM=linux
OPENCLAW_CHANNEL_POLL_INTERVAL_MS=3000
OPENCLAW_CHANNEL_STATE_DIR=
```

Then run:

```bash
npm run channel:setup
```

Linux shortcut:

```bash
chmod +x install-openclaw-channel.sh
./install-openclaw-channel.sh 7H2K9P
```

What that does:

1. calls `POST /v1/openclaw/channel/register`
2. receives `authToken / accountId / pobiId / botKey`
3. adds `extensions/ourhangout` to `plugins.load.paths`
4. enables plugin entry `ourhangout`
5. writes `channels.ourhangout.accounts.<alias>` into your OpenClaw config

The plugin also persists per-account sync cursor state so it can resume after a restart.

- default state dir: `~/.openclaw/state/ourhangout`
- override with `OPENCLAW_CHANNEL_STATE_DIR`

After that, restart the OpenClaw gateway and verify with:

```bash
npm run channel:smoke
```

Optional outbound smoke test:

```bash
npm run channel:smoke -- --room-id <room-uuid> --message "hello from plugin"
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
OPENCLAW_LOCAL_BASE_URL=http://127.0.0.1:18789
CONNECTOR_AUTH_TOKEN=
CONNECTOR_AUTH_TOKEN_FILE=./connector-auth-token.txt
CONNECTOR_RECONNECT_MS=3000
CONNECTOR_REQUEST_TIMEOUT_MS=4000
```

Run:

```bash
npm run start
```

You can also pass the pairing code directly on the command line:

```bash
npm run start -- 7H2K9P
```

or:

```bash
node connector.mjs 7H2K9P
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
curl -s http://127.0.0.1:18789/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"hello"}'
```

## 8. Summary

On the Raspberry Pi:

1. Clone this repository
2. `npm install`
3. Choose one path:
4. Legacy bridge: set `.env`, paste pairing code, run `npm run start`
5. Custom channel plugin: set `.env`, run `npm run channel:setup`, restart OpenClaw, then run `npm run channel:smoke`

## 9. Run as a service

After first pairing succeeds and `connector-auth-token.txt` exists,
you can run the connector as a `systemd` service instead of keeping a terminal open.

Files:

- `deploy/ourhangout-openclaw-connector.service`
- `deploy/SYSTEMD_SETUP_KO.md`
- `install-service.sh`

Fastest setup:

```bash
chmod +x install-service.sh
./install-service.sh 7H2K9P
```

If you omit the code, the script will prompt for it:

```bash
chmod +x install-service.sh
./install-service.sh
```

What the script does:

1. Runs `npm install`
2. Uses the pairing code once to register the connector
3. Waits until `connector-auth-token.txt` is created
4. Installs the `systemd` service
5. Enables and starts the service

Typical setup:

```bash
sudo cp deploy/ourhangout-openclaw-connector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ourhangout-openclaw-connector
```

Check:

```bash
systemctl status ourhangout-openclaw-connector
journalctl -u ourhangout-openclaw-connector -f
```

## 10. How to check duplicate runs

On the Raspberry Pi:

```bash
systemctl status ourhangout-openclaw-connector
ps -ef | grep -E "connector.mjs|npm run start"
```

Normal state:

- service is active
- only one real connector process exists

## 11. Duplicate-run protection

This connector now creates a lock file before starting:

- default: `./connector.lock`

If another instance is already running, a second launch exits immediately with an error.

That means:

- running `npm run start` while the `systemd` service is already active is blocked
- starting the service while a manual connector process is already running is blocked

## 12. If you see websocket 404

If registration succeeds but websocket fails with:

```text
Unexpected server response: 404
```

that usually means:

- your Synology reverse proxy did not forward WebSocket Upgrade headers
- or you are connecting to a public URL that serves normal HTTP but not WebSocket upgrades

What to check:

1. Make sure the reverse proxy / DSM rule allows WebSocket upgrades
2. Test the direct backend websocket URL if available
3. Confirm `HUB_WS_URL` matches the same public URL the app uses
