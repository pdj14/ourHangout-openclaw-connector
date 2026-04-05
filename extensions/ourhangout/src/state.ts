import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { OurHangoutResolvedAccount } from './config.js';

export type OurHangoutPersistedState = {
  afterOrderSeq: number;
  lastSyncAt?: string;
  lastMessageAt?: string;
  updatedAt: string;
};

function normalizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'default';
}

function expandHome(inputPath: string): string {
  const raw = inputPath.trim();
  if (!raw) {
    return raw;
  }

  if (raw === '~') {
    return os.homedir();
  }

  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }

  return raw;
}

export function resolveOurHangoutStateDir(account: OurHangoutResolvedAccount): string {
  const configured = account.stateDir?.trim();
  if (configured) {
    return path.resolve(expandHome(configured));
  }

  return path.join(os.homedir(), '.openclaw', 'state', 'ourhangout');
}

export function resolveOurHangoutStateFile(account: OurHangoutResolvedAccount): string {
  return path.join(resolveOurHangoutStateDir(account), `${normalizeSegment(account.configAccountId)}.json`);
}

export async function loadOurHangoutState(account: OurHangoutResolvedAccount): Promise<OurHangoutPersistedState | null> {
  const filePath = resolveOurHangoutStateFile(account);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<OurHangoutPersistedState>;
    const afterOrderSeq =
      typeof parsed.afterOrderSeq === 'number' && Number.isFinite(parsed.afterOrderSeq)
        ? Math.max(0, Math.floor(parsed.afterOrderSeq))
        : 0;

    return {
      afterOrderSeq,
      ...(typeof parsed.lastSyncAt === 'string' ? { lastSyncAt: parsed.lastSyncAt } : {}),
      ...(typeof parsed.lastMessageAt === 'string' ? { lastMessageAt: parsed.lastMessageAt } : {}),
      updatedAt:
        typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date().toISOString()
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveOurHangoutState(
  account: OurHangoutResolvedAccount,
  state: Omit<OurHangoutPersistedState, 'updatedAt'>
): Promise<string> {
  const filePath = resolveOurHangoutStateFile(account);
  const directory = path.dirname(filePath);
  const payload: OurHangoutPersistedState = {
    afterOrderSeq: Math.max(0, Math.floor(state.afterOrderSeq)),
    ...(state.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}),
    ...(state.lastMessageAt ? { lastMessageAt: state.lastMessageAt } : {}),
    updatedAt: new Date().toISOString()
  };

  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
  return filePath;
}
