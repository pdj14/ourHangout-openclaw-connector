import path from 'path';
import WebSocket from 'ws';
import {
  expandHome,
  getDefaultOpenClawConfigPath,
  loadOpenClawConfig,
  parseArgs,
  parseJsonResponse,
  resolveOurHangoutAccountFromConfig,
  toChannelWsUrl,
  unwrapEnvelope
} from './openclaw-channel-common.mjs';

function normalizeString(value) {
  return String(value || '').trim();
}

function createAuthHeaders(authToken) {
  return {
    authorization: `Bearer ${authToken}`
  };
}

async function readAccountConfig(configPath, accountAlias) {
  const config = await loadOpenClawConfig(configPath);
  const resolved = resolveOurHangoutAccountFromConfig(config, accountAlias);
  const account = resolved.account;

  return {
    alias: resolved.alias,
    serverBaseUrl: normalizeString(account.serverBaseUrl),
    wsUrl: normalizeString(account.wsUrl),
    authToken: normalizeString(account.authToken),
    accountId: normalizeString(account.accountId),
    pobiId: normalizeString(account.pobiId),
    botKey: normalizeString(account.botKey)
  };
}

async function syncMessages(account) {
  const response = await fetch(`${account.serverBaseUrl}/v1/openclaw/channel/messages/sync?limit=5&pobiId=${encodeURIComponent(account.pobiId)}`, {
    headers: createAuthHeaders(account.authToken)
  });

  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      (typeof parsed === 'object' && parsed !== null && typeof parsed.message === 'string' && parsed.message) ||
        `sync failed (${response.status})`
    );
  }

  return unwrapEnvelope(parsed);
}

async function maybeSendMessage(account, roomId, text) {
  const response = await fetch(`${account.serverBaseUrl}/v1/openclaw/channel/messages`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(account.authToken),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      roomId,
      pobiId: account.pobiId,
      text
    })
  });

  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      (typeof parsed === 'object' && parsed !== null && typeof parsed.message === 'string' && parsed.message) ||
        `send failed (${response.status})`
    );
  }

  return unwrapEnvelope(parsed);
}

async function connectWebSocket(account, timeoutMs) {
  const baseWsUrl = normalizeString(account.wsUrl) || toChannelWsUrl(account.serverBaseUrl);
  const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(account.authToken)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let sawConnected = false;
    let sawHelloAck = false;
    const socket = new WebSocket(wsUrl);

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.terminate();
      } catch {
        // no-op
      }
      reject(new Error('websocket timed out'));
    }, timeoutMs);

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          event: 'channel.hello',
          data: {
            pobiIds: [account.pobiId],
            botKeys: [account.botKey]
          }
        })
      );
    });

    socket.on('message', (raw) => {
      const text = raw.toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      if (parsed.event === 'ourhangout.connected') {
        sawConnected = true;
      }
      if (parsed.event === 'channel.hello.ack') {
        sawHelloAck = true;
      }

      if (sawConnected && sawHelloAck && !settled) {
        settled = true;
        clearTimeout(timer);
        socket.close(1000, 'smoke-complete');
        resolve({
          wsUrl,
          connected: true
        });
      }
    });

    socket.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error('websocket closed before connected ack'));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(
    expandHome(args.config || process.env.OPENCLAW_CONFIG_PATH || getDefaultOpenClawConfigPath())
  );
  const accountAlias = normalizeString(args.account || process.env.OPENCLAW_CHANNEL_ACCOUNT_ALIAS || 'default');
  const timeoutMs = Math.max(2000, Number.parseInt(normalizeString(args.timeout || '5000'), 10) || 5000);

  const account = await readAccountConfig(configPath, accountAlias);
  if (!account.serverBaseUrl || !account.authToken || !account.accountId || !account.pobiId || !account.botKey) {
    throw new Error(`ourhangout channel account "${accountAlias}" is incomplete in ${configPath}`);
  }

  const sync = await syncMessages(account);
  const ws = await connectWebSocket(account, timeoutMs);

  console.log('[ourhangout-channel] smoke ok');
  console.log(`  config: ${configPath}`);
  console.log(`  account alias: ${account.alias}`);
  console.log(`  account id: ${account.accountId}`);
  console.log(`  sync items: ${Array.isArray(sync.items) ? sync.items.length : 0}`);
  console.log(`  next afterOrderSeq: ${typeof sync.nextAfterOrderSeq === 'number' ? sync.nextAfterOrderSeq : 0}`);
  console.log(`  websocket: ${ws.wsUrl}`);

  if (typeof args['room-id'] === 'string' && typeof args.message === 'string') {
    const sent = await maybeSendMessage(account, args['room-id'], args.message);
    console.log(`  outbound message id: ${typeof sent?.id === 'string' ? sent.id : '(unknown)'}`);
  }
}

main().catch((error) => {
  console.error('[ourhangout-channel] smoke failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
