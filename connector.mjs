import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const hubWsBase = process.env.HUB_WS_URL ?? 'ws://localhost:3000/v1/openclaw/connector/ws';
const connectorId = process.env.CONNECTOR_ID ?? `connector-local-${Date.now()}`;
const connectorDeviceName = process.env.CONNECTOR_DEVICE_NAME ?? process.env.DEVICE_NAME ?? connectorId;
const pairingCode = (process.env.PAIRING_CODE ?? '').trim().toUpperCase();
const connectorMode = (process.env.CONNECTOR_MODE ?? 'http').trim().toLowerCase();
const localOpenClawBaseUrl = (process.env.OPENCLAW_LOCAL_BASE_URL ?? 'http://127.0.0.1:18888').trim();
const reconnectDelayMs = Number(process.env.CONNECTOR_RECONNECT_MS ?? 3000);
const timeoutMs = Number(process.env.CONNECTOR_REQUEST_TIMEOUT_MS ?? 4000);
const connectorTokenFile = resolveTokenFile(process.env.CONNECTOR_AUTH_TOKEN_FILE ?? './connector-auth-token.txt');

let connectorAuthToken = (process.env.CONNECTOR_AUTH_TOKEN ?? '').trim();
let botKeys = (process.env.CONNECTOR_BOT_KEYS ?? '*').trim();
let wsUrl = '';

function resolveTokenFile(filePath) {
  if (!filePath.trim()) {
    return path.resolve(process.cwd(), 'connector-auth-token.txt');
  }

  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readSavedToken() {
  if (connectorAuthToken) {
    return connectorAuthToken;
  }

  try {
    const token = fs.readFileSync(connectorTokenFile, 'utf8').trim();
    if (token.length >= 16) {
      return token;
    }
  } catch {
    // ignore
  }

  return '';
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(connectorTokenFile), { recursive: true });
  fs.writeFileSync(connectorTokenFile, `${token}\n`, { encoding: 'utf8' });
}

function buildWebSocketUrl(token, currentBotKeys, baseUrl = hubWsBase) {
  const botKeyQuery = currentBotKeys
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `botKey=${encodeURIComponent(value)}`)
    .join('&');

  const query = `token=${encodeURIComponent(token)}&connectorId=${encodeURIComponent(connectorId)}${
    botKeyQuery ? `&${botKeyQuery}` : ''
  }`;

  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

function deriveRegisterBaseUrl() {
  const trimmed = hubWsBase.trim();

  if (/^wss:/i.test(trimmed)) {
    return trimmed.replace(/^wss:/i, 'https:').replace(/\/v1\/openclaw\/connector\/ws.*$/i, '');
  }
  if (/^ws:/i.test(trimmed)) {
    return trimmed.replace(/^ws:/i, 'http:').replace(/\/v1\/openclaw\/connector\/ws.*$/i, '');
  }
  if (/^https?:/i.test(trimmed)) {
    return trimmed.replace(/\/v1\/openclaw\/connector\/ws.*$/i, '');
  }

  throw new Error('Unable to derive register base URL from HUB_WS_URL.');
}

async function registerConnectorByPairing() {
  if (!pairingCode) {
    return;
  }

  const registerBaseUrl = deriveRegisterBaseUrl();
  const response = await fetch(`${registerBaseUrl}/v1/openclaw/connectors/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      pairingCode,
      connectorKey: connectorId,
      deviceName: connectorDeviceName,
      platform: 'linux'
    })
  });

  const text = await response.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(`Connector register failed (${response.status})`);
  }

  const envelope = isRecord(parsed) ? parsed : {};
  const data = isRecord(envelope.data) ? envelope.data : envelope;
  const nextToken = typeof data.connectorAuthToken === 'string' ? data.connectorAuthToken.trim() : '';
  const nextBotKey = typeof data.botKey === 'string' ? data.botKey.trim() : '';
  const nextWsUrl = typeof data.wsUrl === 'string' ? data.wsUrl.trim() : '';

  if (!nextToken) {
    throw new Error('Connector register response did not include connectorAuthToken.');
  }

  connectorAuthToken = nextToken;
  saveToken(connectorAuthToken);

  if (nextBotKey) {
    botKeys = nextBotKey;
  }

  wsUrl = buildWebSocketUrl(connectorAuthToken, botKeys, nextWsUrl || hubWsBase);
  console.log(`[connector] registered device "${connectorDeviceName}" for botKey=${botKeys}`);
}

async function ensureConnectorConfig() {
  connectorAuthToken = readSavedToken();

  if (!connectorAuthToken && pairingCode) {
    await registerConnectorByPairing();
  }

  if (!connectorAuthToken) {
    throw new Error(
      `Connector auth token is missing. Set PAIRING_CODE for first registration or restore ${connectorTokenFile}.`
    );
  }

  wsUrl = buildWebSocketUrl(connectorAuthToken, botKeys);
}

async function callLocalOpenClaw(content, botKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${localOpenClawBaseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content,
        botKey
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }

    if (!response.ok) {
      throw new Error(`OpenClaw HTTP ${response.status}`);
    }

    const parsedObj = isRecord(parsed) ? parsed : {};
    return {
      providerMessageId: typeof parsedObj.providerMessageId === 'string' ? parsedObj.providerMessageId : undefined,
      replyText: typeof parsedObj.replyText === 'string' ? parsedObj.replyText : undefined,
      raw: parsed
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleRequest(payload) {
  const { requestId, content, botKey } = payload.data;

  try {
    if (connectorMode === 'http') {
      const result = await callLocalOpenClaw(content, botKey);
      return {
        event: 'openclaw.response',
        data: {
          requestId,
          ok: true,
          providerMessageId: result.providerMessageId,
          replyText: result.replyText ?? `[connector-http] ${content}`,
          raw: result.raw
        }
      };
    }

    return {
      event: 'openclaw.response',
      data: {
        requestId,
        ok: true,
        providerMessageId: `connector-mock-${Date.now()}`,
        replyText: `[connector-mock${botKey ? `:${botKey}` : ''}] ${content}`
      }
    };
  } catch (error) {
    return {
      event: 'openclaw.response',
      data: {
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'Connector processing failed.'
      }
    };
  }
}

function connect() {
  const socket = new WebSocket(wsUrl);

  socket.on('open', () => {
    console.log(`[connector] connected to hub: ${wsUrl}`);
    socket.send(
      JSON.stringify({
        event: 'connector.hello',
        data: {
          botKeys: botKeys.split(',').map((value) => value.trim()).filter(Boolean),
          mode: connectorMode
        }
      })
    );
  });

  socket.on('message', async (raw) => {
    try {
      const parsed = JSON.parse(raw.toString());
      if (!isRecord(parsed) || parsed.event !== 'openclaw.request' || !isRecord(parsed.data)) {
        return;
      }

      const data = parsed.data;
      if (
        typeof data.requestId !== 'string' ||
        typeof data.messageId !== 'string' ||
        typeof data.roomId !== 'string' ||
        typeof data.senderId !== 'string' ||
        typeof data.recipientId !== 'string' ||
        typeof data.content !== 'string'
      ) {
        return;
      }

      const response = await handleRequest({
        event: 'openclaw.request',
        data: {
          requestId: data.requestId,
          messageId: data.messageId,
          roomId: data.roomId,
          senderId: data.senderId,
          recipientId: data.recipientId,
          botKey: typeof data.botKey === 'string' ? data.botKey : undefined,
          content: data.content,
          requestedAt: typeof data.requestedAt === 'string' ? data.requestedAt : new Date().toISOString()
        }
      });

      socket.send(JSON.stringify(response));
    } catch (error) {
      console.error('[connector] failed to process message', error);
    }
  });

  socket.on('close', () => {
    console.warn(`[connector] disconnected. reconnect in ${reconnectDelayMs}ms`);
    setTimeout(connect, reconnectDelayMs);
  });

  socket.on('error', (error) => {
    console.error('[connector] websocket error', error);
  });
}

ensureConnectorConfig()
  .then(() => {
    connect();
  })
  .catch((error) => {
    console.error('[connector] startup failed', error);
    process.exit(1);
  });
