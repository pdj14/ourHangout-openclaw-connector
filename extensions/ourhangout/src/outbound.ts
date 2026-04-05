import { OurHangoutClient } from './client.js';
import type { OurHangoutResolvedAccount } from './config.js';
import { resolveOutboundTarget } from './threading.js';

function resolveAccountFromParams(params: any): OurHangoutResolvedAccount {
  const account =
    params?.account ??
    params?.resolvedAccount ??
    params?.channelAccount ??
    params?.context?.account ??
    params?.channel?.account;

  if (!account?.serverBaseUrl || !account?.authToken || !account?.pobiId) {
    throw new Error('ourhangout: outbound send requires a resolved account');
  }

  return account as OurHangoutResolvedAccount;
}

function resolveTargetFromParams(params: any, account: OurHangoutResolvedAccount) {
  const rawTarget =
    (typeof params?.to === 'string' && params.to) ||
    (typeof params?.conversationId === 'string' && params.conversationId) ||
    (typeof params?.sessionKey === 'string' && params.sessionKey) ||
    (typeof params?.target?.conversationId === 'string' && params.target.conversationId) ||
    (typeof params?.target?.id === 'string' && params.target.id);

  if (!rawTarget) {
    throw new Error('ourhangout: outbound send requires a room target');
  }

  return resolveOutboundTarget(String(rawTarget), account.pobiId);
}

function resolveTextFromParams(params: any): string {
  const text =
    (typeof params?.text === 'string' && params.text) ||
    (typeof params?.payload?.text === 'string' && params.payload.text) ||
    '';
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('ourhangout: outbound send requires non-empty text');
  }
  return trimmed;
}

function resolveReplyToMessageId(params: any): string | undefined {
  const replyToMessageId =
    (typeof params?.replyToMessageId === 'string' && params.replyToMessageId) ||
    (typeof params?.payload?.replyToMessageId === 'string' && params.payload.replyToMessageId) ||
    (typeof params?.metadata?.replyToMessageId === 'string' && params.metadata.replyToMessageId) ||
    '';
  const trimmed = replyToMessageId.trim();
  return trimmed || undefined;
}

export const ourHangoutOutbound = {
  attachedResults: {
    sendText: async (params: any) => {
      const account = resolveAccountFromParams(params);
      const target = resolveTargetFromParams(params, account);
      const client = OurHangoutClient.fromAccount(account);
      const replyToMessageId = resolveReplyToMessageId(params);
      const response = await client.sendMessage({
        roomId: target.roomId,
        pobiId: target.pobiId,
        text: resolveTextFromParams(params),
        ...(typeof params?.clientMessageId === 'string' ? { clientMessageId: params.clientMessageId } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {})
      });

      return {
        messageId: typeof response?.id === 'string' ? response.id : undefined
      };
    }
  }
};
