import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import JSON5 from 'json5';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoDir = path.resolve(__dirname, '..');
export const repoEnvPath = path.join(repoDir, '.env');

dotenv.config({ path: repoEnvPath });

export function parseArgs(argv) {
  const result = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }

    const body = token.slice(2);
    if (!body) {
      continue;
    }

    const [rawKey, inlineValue] = body.split('=', 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    index += 1;
  }

  return result;
}

export function expandHome(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) {
    return '';
  }

  if (raw === '~') {
    return os.homedir();
  }

  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }

  return raw;
}

export function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export async function loadJson5File(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON5.parse(raw);
}

export async function loadOpenClawConfig(configPath) {
  try {
    const parsed = await loadJson5File(configPath);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeOpenClawConfig(configPath, config, options = {}) {
  const targetPath = path.resolve(expandHome(configPath));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const shouldBackup = options.backup !== false;
  if (shouldBackup) {
    try {
      const backupPath = `${targetPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.copyFile(targetPath, backupPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  await fs.writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return targetPath;
}

export function uniquePush(array, value) {
  if (!value) {
    return array;
  }

  if (!array.includes(value)) {
    array.push(value);
  }
  return array;
}

export function getDefaultOpenClawConfigPath() {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

export function toChannelWsUrl(serverBaseUrl) {
  const baseUrl = normalizeBaseUrl(serverBaseUrl);
  if (/^https:/i.test(baseUrl)) {
    return `${baseUrl.replace(/^https:/i, 'wss:')}/v1/openclaw/channel/ws`;
  }
  if (/^http:/i.test(baseUrl)) {
    return `${baseUrl.replace(/^http:/i, 'ws:')}/v1/openclaw/channel/ws`;
  }
  return `${baseUrl}/v1/openclaw/channel/ws`;
}

export async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function unwrapEnvelope(payload) {
  return typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : payload;
}

export function resolveOurHangoutAccountFromConfig(config, accountAlias) {
  const channels = typeof config.channels === 'object' && config.channels !== null ? config.channels : {};
  const section = typeof channels.ourhangout === 'object' && channels.ourhangout !== null ? channels.ourhangout : {};
  const accounts = typeof section.accounts === 'object' && section.accounts !== null ? section.accounts : {};
  const requested = String(accountAlias || section.defaultAccount || 'default').trim();
  const account = accounts[requested];

  if (!account || typeof account !== 'object') {
    throw new Error(`ourhangout channel account "${requested}" not found in ${getDefaultOpenClawConfigPath()}`);
  }

  return {
    alias: requested,
    section,
    account
  };
}
