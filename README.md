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

Set these in `.env` for the custom channel path:

```env
OURHANGOUT_SERVER_BASE_URL=http://wowjini0228.synology.me:7084
OPENCLAW_CHANNEL_WS_URL=ws://wowjini0228.synology.me:7084/v1/openclaw/channel/ws
OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw.json
OPENCLAW_CHANNEL_ACCOUNT_ALIAS=default
OPENCLAW_CHANNEL_PAIRING_CODE=7H2K9P
OPENCLAW_CHANNEL_DEVICE_KEY=raspi-openclaw-1
OPENCLAW_CHANNEL_DEVICE_NAME=Living Room Pi
OPENCLAW_CHANNEL_PLATFORM=linux
OPENCLAW_CHANNEL_POLL_INTERVAL_MS=3000
OPENCLAW_CHANNEL_STATE_DIR=~/.openclaw/state/ourhangout
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

## 3. Summary

On the Raspberry Pi:

1. Clone this repository
2. `npm install`
3. Copy `.env.example` to `.env`
4. Paste the app pairing code into `OPENCLAW_CHANNEL_PAIRING_CODE`
5. Run `npm run channel:setup`
6. Restart OpenClaw gateway
7. Run `npm run channel:smoke`

## 4. If you see websocket 404

If registration succeeds but websocket fails with:

```text
Unexpected server response: 404
```

that usually means:

- the websocket URL is wrong for the current environment
- or your reverse proxy did not forward WebSocket Upgrade headers

What to check:

1. Confirm `OURHANGOUT_SERVER_BASE_URL` is correct for the target environment
2. Confirm `OPENCLAW_CHANNEL_WS_URL` matches the actual websocket endpoint
3. Make sure the reverse proxy / DSM rule allows WebSocket upgrades
