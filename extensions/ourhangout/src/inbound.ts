import { randomUUID } from 'crypto';
import path from 'path';
import { OurHangoutClient } from './client.js';
import { listOurHangoutAccountIds, resolveOurHangoutAccount, type OurHangoutResolvedAccount } from './config.js';
import { buildDirectSessionKey } from './threading.js';

export function toOpenClawInboundEnvelope(event: {
  accountId: string;
  roomId: string;
  pobiId: string;
  senderUserId: string;
  messageId: string;
  kind: 'text' | 'image' | 'video' | 'system';
  text?: string;
  uri?: string;
  replyToMessageId?: string;
  createdAt: string;
  sessionKey: string;
}): Record<string, unknown> {
  return {
    channel: 'ourhangout',
    accountId: event.accountId,
    conversationId: buildDirectSessionKey(event.roomId, event.pobiId),
    senderId: event.senderUserId,
    messageId: event.messageId,
    text: event.text ?? `${event.kind}:${event.uri ?? ''}`,
    metadata: {
      roomId: event.roomId,
      pobiId: event.pobiId,
      createdAt: event.createdAt,
      sessionKey: event.sessionKey,
      kind: event.kind,
      ...(event.replyToMessageId ? { replyToMessageId: event.replyToMessageId } : {}),
      ...(event.uri ? { uri: event.uri } : {})
    }
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConfiguredModelRef(api: any): string {
  return (
    normalizeText(api?.config?.models?.resolvedDefault) ||
    normalizeText(api?.config?.models?.defaultModel) ||
    normalizeText(api?.config?.agents?.model) ||
    normalizeText(api?.config?.model) ||
    normalizeText(api?.runtime?.agent?.defaults?.model) ||
    'openrouter/auto'
  );
}

function resolveDefaultProvider(api: any): string {
  const configProvider =
    normalizeText(api?.config?.models?.defaultProvider) ||
    normalizeText(api?.config?.agents?.provider) ||
    normalizeText(api?.config?.provider);
  if (configProvider) {
    return configProvider;
  }

  const configuredModelRef = resolveConfiguredModelRef(api);
  const modelProvider = normalizeText(configuredModelRef.split('/')[0]);
  if (modelProvider) {
    return modelProvider;
  }

  const runtimeProvider = normalizeText(api?.runtime?.agent?.defaults?.provider);
  if (runtimeProvider) {
    return runtimeProvider;
  }

  return 'openrouter';
}

function resolveDefaultModel(api: any): string {
  const configModel = resolveConfiguredModelRef(api);
  if (configModel) {
    return configModel;
  }

  return 'openrouter/auto';
}

function normalizeModelForRun(model: string): string {
  const trimmed = normalizeText(model);
  if (!trimmed) {
    return 'auto';
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return trimmed;
  }

  return trimmed.slice(slashIndex + 1);
}

function resolveAccountForEvent(api: any, event: { accountId: string; pobiId: string }): OurHangoutResolvedAccount {
  const cfg = api?.config ?? api?.runtime?.config ?? {};

  for (const accountId of listOurHangoutAccountIds(cfg)) {
    const account = resolveOurHangoutAccount(cfg, accountId);
    if (account.accountId === event.accountId || account.pobiId === event.pobiId) {
      return account;
    }
  }

  throw new Error(`ourhangout: no configured account matched event accountId=${event.accountId} pobiId=${event.pobiId}`);
}

function buildSessionId(event: { accountId: string; roomId: string; pobiId: string }): string {
  return `ourhangout_${event.accountId}_${event.roomId}_${event.pobiId}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function buildPrompt(event: {
  senderUserId: string;
  kind: 'text' | 'image' | 'video' | 'system';
  text?: string;
  uri?: string;
  replyToMessageId?: string;
}): string {
  const content = normalizeText(event.text) || `${event.kind}:${normalizeText(event.uri)}`;
  const lines = [
    `You are replying in the OurHangout channel.`,
    `Sender user id: ${event.senderUserId}`,
    `Message kind: ${event.kind}`,
    `Message: ${content}`
  ];

  if (event.replyToMessageId) {
    lines.push(`Replying to message id: ${event.replyToMessageId}`);
  }

  lines.push('Reply naturally as the linked Pobi in the same conversation.');
  return lines.join('\n');
}

export async function dispatchOurHangoutInbound(
  api: any,
  event: {
    accountId: string;
    roomId: string;
    pobiId: string;
    senderUserId: string;
    messageId: string;
    kind: 'text' | 'image' | 'video' | 'system';
    text?: string;
    uri?: string;
    replyToMessageId?: string;
    createdAt: string;
    sessionKey: string;
  }
): Promise<void> {
  const runtimeAgent = api?.runtime?.agent;
  if (!runtimeAgent?.runEmbeddedPiAgent) {
    api?.logger?.warn?.('OurHangout runtime does not expose api.runtime.agent.runEmbeddedPiAgent');
    return;
  }

  const account = resolveAccountForEvent(api, event);
  const client = OurHangoutClient.fromAccount(account);
  const cfg = api.config;
  const sessionId = buildSessionId(event);
  const agentDir = runtimeAgent.resolveAgentDir(cfg);
  const sessionFile = path.join(agentDir, 'sessions', `${sessionId}.jsonl`);
  const workspaceDir = runtimeAgent.resolveAgentWorkspaceDir(cfg);
  const timeoutMs = runtimeAgent.resolveAgentTimeoutMs(cfg);
  const provider = resolveDefaultProvider(api);
  const model = normalizeModelForRun(resolveDefaultModel(api));
  const sentTexts = new Set<string>();

  await runtimeAgent.ensureAgentWorkspace(cfg);

  api?.logger?.info?.(
    `OurHangout agent run starting (accountId=${event.accountId}, sessionId=${sessionId}, sessionKey=${event.sessionKey})`
  );

  await runtimeAgent.runEmbeddedPiAgent({
    sessionId,
    sessionKey: event.sessionKey,
    sessionFile,
    workspaceDir,
    config: cfg,
    prompt: buildPrompt(event),
    provider,
    model,
    timeoutMs,
    runId: randomUUID(),
    onBlockReply: async (payload: { text?: string }) => {
      const text = normalizeText(payload?.text);
      if (!text || sentTexts.has(text)) {
        return;
      }

      sentTexts.add(text);
      await client.sendMessage({
        roomId: event.roomId,
        pobiId: event.pobiId,
        text,
        clientMessageId: `ourhangout-${randomUUID()}`,
        replyToMessageId: event.messageId
      });
    }
  });

  api?.logger?.info?.(
    `OurHangout agent run finished (accountId=${event.accountId}, sessionId=${sessionId}, sentBlocks=${sentTexts.size})`
  );
}
