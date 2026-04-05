import path from 'path';
import {
  expandHome,
  getDefaultOpenClawConfigPath,
  loadOpenClawConfig,
  normalizeBaseUrl,
  parseArgs,
  parseJsonResponse,
  repoDir,
  toChannelWsUrl,
  uniquePush,
  unwrapEnvelope,
  writeOpenClawConfig
} from './openclaw-channel-common.mjs';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePairingCode(value) {
  return normalizeString(value).toUpperCase().replace(/\s+/g, '');
}

function ensureObject(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

async function registerChannel(input) {
  const response = await fetch(`${input.serverBaseUrl}/v1/openclaw/channel/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      pairingCode: input.pairingCode,
      deviceKey: input.deviceKey,
      deviceName: input.deviceName,
      platform: input.platform
    })
  });

  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    const message =
      (typeof parsed === 'object' && parsed !== null && typeof parsed.message === 'string' && parsed.message) ||
      `register failed (${response.status})`;
    throw new Error(message);
  }

  return unwrapEnvelope(parsed);
}

function patchOpenClawConfig(config, input) {
  const next = ensureObject(structuredClone(config));
  next.plugins = ensureObject(next.plugins);
  next.plugins.load = ensureObject(next.plugins.load);
  next.plugins.entries = ensureObject(next.plugins.entries);
  next.channels = ensureObject(next.channels);
  next.channels.ourhangout = ensureObject(next.channels.ourhangout);

  const loadPaths = Array.isArray(next.plugins.load.paths) ? [...next.plugins.load.paths] : [];
  uniquePush(loadPaths, input.pluginPath);
  next.plugins.enabled = true;
  next.plugins.load.paths = loadPaths;
  next.plugins.entries.ourhangout = {
    ...ensureObject(next.plugins.entries.ourhangout),
    enabled: true
  };

  const section = next.channels.ourhangout;
  const accounts = ensureObject(section.accounts);
  section.defaultAccount = input.accountAlias;
  section.pollIntervalMs = input.pollIntervalMs;
  section.accounts = {
    ...accounts,
    [input.accountAlias]: {
      ...ensureObject(accounts[input.accountAlias]),
      enabled: true,
      serverBaseUrl: input.serverBaseUrl,
      ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
      authToken: input.registration.authToken,
      accountId: input.registration.accountId,
      pobiId: input.registration.pobiId,
      botKey: input.registration.botKey,
      deviceKey: input.deviceKey,
      sessionKeyPrefix: input.registration.sessionKeyPrefix || 'ourhangout:direct',
      pollIntervalMs: input.pollIntervalMs,
      ...(input.stateDir ? { stateDir: input.stateDir } : {})
    }
  };

  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const pairingCode = normalizePairingCode(
    args['pairing-code'] ||
      args.pairingCode ||
      args._[0] ||
      process.env.OPENCLAW_CHANNEL_PAIRING_CODE ||
      process.env.PAIRING_CODE
  );
  const serverBaseUrl = normalizeBaseUrl(args.server || process.env.OURHANGOUT_SERVER_BASE_URL);
  const accountAlias = normalizeString(args.account || process.env.OPENCLAW_CHANNEL_ACCOUNT_ALIAS || 'default');
  const deviceKey = normalizeString(args['device-key'] || process.env.OPENCLAW_CHANNEL_DEVICE_KEY || 'raspi-openclaw-1');
  const deviceName = normalizeString(
    args['device-name'] || process.env.OPENCLAW_CHANNEL_DEVICE_NAME || 'Living Room Pi'
  );
  const platform = normalizeString(args.platform || process.env.OPENCLAW_CHANNEL_PLATFORM || 'linux');
  const configuredWsUrl = normalizeString(args['ws-url'] || process.env.OPENCLAW_CHANNEL_WS_URL);
  const configPath = path.resolve(expandHome(args.config || process.env.OPENCLAW_CONFIG_PATH || getDefaultOpenClawConfigPath()));
  const pollIntervalMs = Math.max(
    1000,
    Number.parseInt(
      normalizeString(args['poll-ms'] || process.env.OPENCLAW_CHANNEL_POLL_INTERVAL_MS || '3000'),
      10
    ) || 3000
  );
  const stateDir = normalizeString(args['state-dir'] || process.env.OPENCLAW_CHANNEL_STATE_DIR);
  const pluginPath = path.resolve(repoDir, 'extensions', 'ourhangout');

  if (!serverBaseUrl) {
    throw new Error('OURHANGOUT_SERVER_BASE_URL or --server is required');
  }
  if (!pairingCode) {
    throw new Error('OPENCLAW_CHANNEL_PAIRING_CODE or a positional pairing code argument is required');
  }

  const registration = await registerChannel({
    serverBaseUrl,
    pairingCode,
    deviceKey,
    deviceName,
    platform
  });

  const currentConfig = await loadOpenClawConfig(configPath);
  const nextConfig = patchOpenClawConfig(currentConfig, {
    accountAlias,
    deviceKey,
    pluginPath,
    pollIntervalMs,
    registration,
    serverBaseUrl,
    stateDir,
    wsUrl: configuredWsUrl
  });

  const writtenPath = await writeOpenClawConfig(configPath, nextConfig);

  const effectiveWsUrl = configuredWsUrl || registration.wsUrl || `${toChannelWsUrl(serverBaseUrl)}?token=<hidden>`;
  console.log('[ourhangout-channel] registration complete');
  console.log(`  config: ${writtenPath}`);
  console.log(`  plugin path: ${pluginPath}`);
  console.log(`  account alias: ${accountAlias}`);
  console.log(`  account id: ${registration.accountId}`);
  console.log(`  pobi id: ${registration.pobiId}`);
  console.log(`  bot key: ${registration.botKey}`);
  console.log(`  ws: ${effectiveWsUrl}`);
  if (stateDir) {
    console.log(`  state dir: ${stateDir}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Install OpenClaw if it is not installed yet.');
  console.log('  2. Restart the gateway so it reloads plugins and channel config.');
  console.log('  3. Run `npm run channel:smoke` in this repo to verify register/ws/sync.');
}

main().catch((error) => {
  console.error('[ourhangout-channel] setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
