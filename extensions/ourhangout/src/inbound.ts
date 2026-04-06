import { randomUUID } from 'crypto';
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
  const sessionFile = runtimeAgent.session.resolveSessionFilePath(cfg, sessionId);
  const workspaceDir = runtimeAgent.resolveAgentWorkspaceDir(cfg);
  const timeoutMs = runtimeAgent.resolveAgentTimeoutMs(cfg);
  const provider = runtimeAgent.defaults.provider;
  const model = runtimeAgent.defaults.model;
  const thinkingLevel = runtimeAgent.resolveThinkingDefault(cfg, provider, model);
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
    thinkingLevel,
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
