import type { OpenClawConfig } from 'openclaw/plugin-sdk/channel-core';

export type OurHangoutDmPolicy = 'open' | 'allowlist' | 'disabled';

export type OurHangoutAccountConfig = {
  enabled?: boolean;
  serverBaseUrl?: string;
  authToken?: string;
  accountId?: string;
  pobiId?: string;
  botKey?: string;
  deviceKey?: string;
  sessionKeyPrefix?: string;
  pollIntervalMs?: number;
  stateDir?: string;
  dmPolicy?: OurHangoutDmPolicy;
  allowFrom?: string[];
};

export type OurHangoutChannelConfig = {
  defaultAccount?: string;
  pollIntervalMs?: number;
  stateDir?: string;
  dmPolicy?: OurHangoutDmPolicy;
  allowFrom?: string[];
  accounts?: Record<string, OurHangoutAccountConfig>;
};

export type OurHangoutResolvedAccount = {
  configAccountId: string;
  accountId: string;
  serverBaseUrl: string;
  authToken: string;
  pobiId: string;
  botKey: string;
  deviceKey?: string;
  sessionKeyPrefix: string;
  pollIntervalMs: number;
  stateDir?: string;
  dmPolicy: OurHangoutDmPolicy;
  allowFrom: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeServerBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getOurHangoutChannelConfig(cfg: OpenClawConfig): OurHangoutChannelConfig {
  const channels = asRecord(asRecord(cfg).channels);
  return asRecord(channels.ourhangout) as OurHangoutChannelConfig;
}

function getAccountMap(cfg: OpenClawConfig): Record<string, OurHangoutAccountConfig> {
  const section = getOurHangoutChannelConfig(cfg);
  const accounts = asRecord(section.accounts);
  const accountIds = Object.keys(accounts);
  if (accountIds.length > 0) {
    const mapped: Record<string, OurHangoutAccountConfig> = {};
    for (const accountId of accountIds) {
      mapped[accountId] = asRecord(accounts[accountId]) as OurHangoutAccountConfig;
    }
    return mapped;
  }

  if (normalizeString((section as Record<string, unknown>).serverBaseUrl)) {
    return {
      default: section as OurHangoutAccountConfig
    };
  }

  return {};
}

export function listOurHangoutAccountIds(cfg: OpenClawConfig): string[] {
  return Object.entries(getAccountMap(cfg))
    .filter(([, account]) => account.enabled !== false)
    .map(([accountId]) => accountId)
    .sort();
}

export function resolveOurHangoutAccount(
  cfg: OpenClawConfig,
  accountId?: string | null
): OurHangoutResolvedAccount {
  const section = getOurHangoutChannelConfig(cfg);
  const accounts = getAccountMap(cfg);
  const configuredAccountIds = Object.keys(accounts).sort();
  const requestedAccountId =
    normalizeString(accountId) || normalizeString(section.defaultAccount) || configuredAccountIds[0] || 'default';
  const rawAccount = accounts[requestedAccountId];

  if (!rawAccount || rawAccount.enabled === false) {
    throw new Error(`ourhangout: account "${requestedAccountId}" is not configured`);
  }

  const serverBaseUrl = normalizeServerBaseUrl(normalizeString(rawAccount.serverBaseUrl));
  const authToken = normalizeString(rawAccount.authToken);
  const resolvedAccountId = normalizeString(rawAccount.accountId);
  const pobiId = normalizeString(rawAccount.pobiId);
  const botKey = normalizeString(rawAccount.botKey);
  const sessionKeyPrefix = normalizeString(rawAccount.sessionKeyPrefix) || 'ourhangout:direct';
  const stateDir = normalizeString(rawAccount.stateDir ?? section.stateDir);

  const missing = [
    !serverBaseUrl ? 'serverBaseUrl' : '',
    !authToken ? 'authToken' : '',
    !resolvedAccountId ? 'accountId' : '',
    !pobiId ? 'pobiId' : '',
    !botKey ? 'botKey' : ''
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `ourhangout: missing required config fields for account "${requestedAccountId}": ${missing.join(', ')}`
    );
  }

  return {
    configAccountId: requestedAccountId,
    accountId: resolvedAccountId,
    serverBaseUrl,
    authToken,
    pobiId,
    botKey,
    ...(normalizeString(rawAccount.deviceKey) ? { deviceKey: normalizeString(rawAccount.deviceKey) } : {}),
    sessionKeyPrefix,
    pollIntervalMs: rawAccount.pollIntervalMs ?? section.pollIntervalMs ?? 3000,
    ...(stateDir ? { stateDir } : {}),
    dmPolicy: rawAccount.dmPolicy ?? section.dmPolicy ?? 'open',
    allowFrom: normalizeStringArray(rawAccount.allowFrom ?? section.allowFrom)
  };
}

export function inspectOurHangoutAccount(cfg: OpenClawConfig, accountId?: string | null): Record<string, unknown> {
  try {
    const account = resolveOurHangoutAccount(cfg, accountId);
    return {
      enabled: true,
      configured: true,
      accountId: account.configAccountId,
      tokenStatus: 'available'
    };
  } catch (error) {
    return {
      enabled: listOurHangoutAccountIds(cfg).length > 0,
      configured: false,
      tokenStatus: 'missing',
      error: error instanceof Error ? error.message : 'Invalid OurHangout config'
    };
  }
}
