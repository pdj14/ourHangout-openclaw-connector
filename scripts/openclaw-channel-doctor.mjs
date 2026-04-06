import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import {
  expandHome,
  getDefaultOpenClawConfigPath,
  loadOpenClawConfig,
  normalizeBaseUrl,
  repoDir,
  resolveOurHangoutAccountFromConfig,
  toChannelWsUrl
} from './openclaw-channel-common.mjs';

const KNOWN_PROVIDER_IDS = new Set([
  'anthropic',
  'github-copilot',
  'google',
  'modelstudio',
  'ollama',
  'openai',
  'openai-codex',
  'openrouter',
  'venice',
  'vllm',
  'xai',
  'zai'
]);

const PROVIDER_ENV_VARS = {
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  modelstudio: ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'MODELSTUDIO_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'openai-codex': ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  venice: ['VENICE_API_KEY'],
  vllm: ['VLLM_API_KEY', 'OPENAI_API_KEY'],
  xai: ['XAI_API_KEY'],
  zai: ['ZAI_API_KEY']
};

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureObject(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

function getNestedValue(root, keys) {
  let current = root;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstString(candidates, fallback = '') {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function resolveConfiguredModelRef(config) {
  return firstString([
    getNestedValue(config, ['agents', 'defaults', 'model', 'primary']),
    getNestedValue(config, ['models', 'resolvedDefault']),
    getNestedValue(config, ['models', 'defaultModel']),
    getNestedValue(config, ['agents', 'model']),
    getNestedValue(config, ['model'])
  ]);
}

function resolveConfiguredFallbacks(config) {
  const values = [];

  const agentFallbacks = getNestedValue(config, ['agents', 'defaults', 'model', 'fallbacks']);
  if (Array.isArray(agentFallbacks)) {
    values.push(...agentFallbacks);
  }

  const modelFallbacks = getNestedValue(config, ['models', 'fallbacks']);
  if (Array.isArray(modelFallbacks)) {
    values.push(...modelFallbacks);
  }

  return uniqueStrings(values);
}

function resolveConfiguredProvider(config) {
  const modelRef = resolveConfiguredModelRef(config);
  const modelProvider = normalizeString(modelRef.split('/')[0]).toLowerCase();
  if (KNOWN_PROVIDER_IDS.has(modelProvider)) {
    return modelProvider;
  }

  return firstString(
    [
      getNestedValue(config, ['models', 'defaultProvider']),
      getNestedValue(config, ['agents', 'defaults', 'provider']),
      getNestedValue(config, ['agents', 'provider']),
      getNestedValue(config, ['provider'])
    ],
    modelRef ? '' : 'openrouter'
  ).toLowerCase();
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readUtf8IfExists(targetPath) {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inspectAuthStore(raw, provider) {
  if (!raw) {
    return {
      hasProviderProfiles: false,
      profileIds: []
    };
  }

  const matches = raw.match(new RegExp(`${escapeRegExp(provider)}:[A-Za-z0-9._@-]+`, 'gi')) || [];
  const profileIds = uniqueStrings(matches);
  const hasProviderMention =
    profileIds.length > 0 ||
    raw.includes(`"${provider}"`) ||
    raw.includes(`'${provider}'`) ||
    raw.includes(`${provider}:default`);

  return {
    hasProviderProfiles: hasProviderMention,
    profileIds
  };
}

async function loadGatewayEnv(envPath) {
  const raw = await readUtf8IfExists(envPath);
  if (!raw) {
    return {};
  }
  return dotenv.parse(raw);
}

function buildProviderFixes(provider, agentId, gatewayEnvPath) {
  const envPath = gatewayEnvPath.replace(/\\/g, '/');

  if (provider === 'anthropic') {
    return [
      'openclaw models status',
      'openclaw models auth setup-token --provider anthropic',
      `Add ANTHROPIC_API_KEY to ${envPath} if you want API-key auth instead`,
      `openclaw models auth order clear --provider anthropic --agent ${agentId}`,
      'openclaw gateway restart'
    ];
  }

  const envVars = PROVIDER_ENV_VARS[provider] || [];
  const fixes = ['openclaw models status'];
  if (envVars.length > 0) {
    fixes.push(`Add one of ${envVars.join(', ')} to ${envPath}`);
  }
  fixes.push('openclaw gateway restart');
  return fixes;
}

export async function runOurHangoutDoctor(options = {}) {
  const configPath = path.resolve(expandHome(options.configPath || getDefaultOpenClawConfigPath()));
  const agentId = normalizeString(options.agentId || process.env.OPENCLAW_AGENT_ID || 'main') || 'main';
  const accountAlias = normalizeString(options.accountAlias || process.env.OPENCLAW_CHANNEL_ACCOUNT_ALIAS);
  const expectedPluginPath = path.resolve(options.pluginPath || path.join(repoDir, 'extensions', 'ourhangout'));
  const configuredOpenClawHome = normalizeString(options.openClawHome || process.env.OPENCLAW_HOME);
  const homeDir = path.resolve(expandHome(options.homeDir || os.homedir()));
  const openClawHome = configuredOpenClawHome
    ? path.resolve(expandHome(configuredOpenClawHome))
    : path.join(homeDir, '.openclaw');
  const authStorePath = path.join(openClawHome, 'agents', agentId, 'agent', 'auth-profiles.json');
  const gatewayEnvPath = path.join(openClawHome, '.env');
  const config = await loadOpenClawConfig(configPath);

  const lines = [];
  const blocking = [];
  const warnings = [];

  const plugins = ensureObject(config.plugins);
  const pluginLoad = ensureObject(plugins.load);
  const pluginEntries = ensureObject(plugins.entries);
  const configuredPluginPaths = Array.isArray(pluginLoad.paths)
    ? pluginLoad.paths.map((value) => path.resolve(expandHome(String(value))))
    : [];
  const pluginPathConfigured = configuredPluginPaths.includes(expectedPluginPath);
  const pluginEntry = ensureObject(pluginEntries.ourhangout);
  const pluginEnabled = plugins.enabled === true;
  const pluginEntryEnabled = pluginEntry.enabled === true;

  let resolvedAccount = null;
  let accountError = '';
  try {
    const resolved = resolveOurHangoutAccountFromConfig(config, accountAlias);
    const section = ensureObject(resolved.section);
    const account = ensureObject(resolved.account);
    resolvedAccount = {
      alias: resolved.alias,
      serverBaseUrl: normalizeBaseUrl(account.serverBaseUrl),
      wsUrl: normalizeString(account.wsUrl) || toChannelWsUrl(normalizeBaseUrl(account.serverBaseUrl)),
      authToken: normalizeString(account.authToken),
      accountId: normalizeString(account.accountId),
      pobiId: normalizeString(account.pobiId),
      botKey: normalizeString(account.botKey),
      stateDir: normalizeString(account.stateDir ?? section.stateDir),
      pollIntervalMs: Number.parseInt(String(account.pollIntervalMs ?? section.pollIntervalMs ?? 3000), 10) || 3000
    };

    const missingFields = [
      !resolvedAccount.serverBaseUrl ? 'serverBaseUrl' : '',
      !resolvedAccount.authToken ? 'authToken' : '',
      !resolvedAccount.accountId ? 'accountId' : '',
      !resolvedAccount.pobiId ? 'pobiId' : '',
      !resolvedAccount.botKey ? 'botKey' : ''
    ].filter(Boolean);
    if (missingFields.length > 0) {
      blocking.push(
        `ourhangout account "${resolvedAccount.alias}" is missing required fields: ${missingFields.join(', ')}`
      );
    }
  } catch (error) {
    accountError = error instanceof Error ? error.message : String(error);
    blocking.push(`ourhangout account config is incomplete: ${accountError}`);
  }

  const configuredModelRef = resolveConfiguredModelRef(config);
  const configuredFallbacks = resolveConfiguredFallbacks(config);
  const configuredProvider = resolveConfiguredProvider(config);
  const effectiveModelRef = configuredModelRef || 'openrouter/auto (plugin fallback)';
  const effectiveProvider = configuredProvider || 'openrouter';
  const authStoreExists = await fileExists(authStorePath);
  const authStoreRaw = await readUtf8IfExists(authStorePath);
  const authStore = inspectAuthStore(authStoreRaw, effectiveProvider);
  const gatewayEnv = await loadGatewayEnv(gatewayEnvPath);
  const matchingEnvVars = (PROVIDER_ENV_VARS[effectiveProvider] || []).filter((name) => normalizeString(gatewayEnv[name]));

  lines.push('[ourhangout-channel] doctor');
  lines.push(`  config: ${configPath}`);
  lines.push(`  plugin path: ${expectedPluginPath}`);
  lines.push(`  agent id: ${agentId}`);
  lines.push(`  default model: ${effectiveModelRef}`);
  lines.push(`  default provider: ${effectiveProvider}`);
  lines.push(`  auth store: ${authStorePath}`);
  lines.push(`  gateway env: ${gatewayEnvPath}`);
  lines.push('');
  lines.push('Checks:');

  if (pluginEnabled) {
    lines.push('  [ok] plugins.enabled is true');
  } else {
    blocking.push('plugins.enabled is not true in openclaw.json');
    lines.push('  [fail] plugins.enabled is not true');
  }

  if (pluginPathConfigured) {
    lines.push('  [ok] plugins.load.paths includes extensions/ourhangout');
  } else {
    blocking.push(`plugins.load.paths does not include ${expectedPluginPath}`);
    lines.push('  [fail] plugins.load.paths is missing the ourhangout plugin path');
  }

  if (pluginEntryEnabled) {
    lines.push('  [ok] plugins.entries.ourhangout.enabled is true');
  } else {
    blocking.push('plugins.entries.ourhangout.enabled is not true');
    lines.push('  [fail] plugins.entries.ourhangout.enabled is not true');
  }

  if (resolvedAccount) {
    lines.push(
      `  [ok] account "${resolvedAccount.alias}" is configured (accountId=${resolvedAccount.accountId}, pobiId=${resolvedAccount.pobiId})`
    );
    lines.push(`  [ok] websocket target resolves to ${resolvedAccount.wsUrl}`);
  } else {
    lines.push(`  [fail] ${accountError}`);
  }

  if (configuredModelRef) {
    lines.push(`  [ok] OpenClaw default model resolves to ${configuredModelRef}`);
  } else {
    warnings.push('No primary model is configured; the plugin will fall back to openrouter/auto.');
    lines.push('  [warn] no primary model was found; plugin runtime will fall back to openrouter/auto');
  }

  if (configuredFallbacks.length > 0) {
    lines.push(`  [ok] configured fallbacks: ${configuredFallbacks.join(', ')}`);
  }

  if (authStoreExists) {
    if (authStore.hasProviderProfiles) {
      const detail =
        authStore.profileIds.length > 0 ? ` (${authStore.profileIds.join(', ')})` : ' (provider hints found)';
      lines.push(`  [ok] auth store contains ${effectiveProvider} credentials${detail}`);
    } else if (matchingEnvVars.length > 0) {
      lines.push(
        `  [ok] ${matchingEnvVars.join(', ')} is present in ~/.openclaw/.env, so gateway env can provide auth`
      );
    } else {
      blocking.push(
        `${effectiveProvider} auth was not detected in ${authStorePath} and no matching provider env var was found in ${gatewayEnvPath}`
      );
      lines.push(`  [fail] ${effectiveProvider} auth was not detected in auth-profiles.json or ~/.openclaw/.env`);
    }
  } else if (matchingEnvVars.length > 0) {
    lines.push(`  [ok] auth store file is missing, but ${matchingEnvVars.join(', ')} exists in ~/.openclaw/.env`);
  } else {
    blocking.push(
      `auth store is missing for agent "${agentId}" and no ${effectiveProvider} provider env var was found in ${gatewayEnvPath}`
    );
    lines.push(`  [fail] auth store is missing for agent "${agentId}" and no provider env override was found`);
  }

  if (blocking.length > 0) {
    lines.push('');
    lines.push('Blocking items:');
    for (const item of blocking) {
      lines.push(`  - ${item}`);
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const item of warnings) {
      lines.push(`  - ${item}`);
    }
  }

  if (blocking.length > 0) {
    lines.push('');
    lines.push('Suggested fixes:');
    for (const step of buildProviderFixes(effectiveProvider, agentId, gatewayEnvPath)) {
      lines.push(`  - ${step}`);
    }
    lines.push(
      '  - If you do not want this provider, change agents.defaults.model.primary to a model whose provider is already authenticated.'
    );
  }

  return {
    ok: blocking.length === 0,
    text: lines.join('\n'),
    blocking,
    warnings,
    configPath,
    authStorePath,
    gatewayEnvPath,
    provider: effectiveProvider,
    modelRef: effectiveModelRef
  };
}

export function formatOurHangoutDoctorReport(report) {
  return report.text;
}
