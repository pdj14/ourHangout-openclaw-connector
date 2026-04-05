import type { OurHangoutInboundMessage } from './client.js';
import { buildDirectSessionKey } from './threading.js';

export function toOpenClawInboundEnvelope(event: OurHangoutInboundMessage): Record<string, unknown> {
  return {
    channel: 'ourhangout',
    accountId: event.accountId,
    conversationId: buildDirectSessionKey(event.roomId, event.pobiId),
    senderId: event.senderUserId,
    messageId: event.messageId,
    text: event.text ?? `${event.kind}:${event.uri ?? ''}`,
    metadata: {
      roomId: event.roomId,
      roomType: event.roomType,
      pobiId: event.pobiId,
      botKey: event.botKey,
      botUserId: event.botUserId,
      orderSeq: event.orderSeq,
      createdAt: event.createdAt,
      sessionKey: event.sessionKey,
      kind: event.kind,
      ...(event.replyToMessageId ? { replyToMessageId: event.replyToMessageId } : {}),
      ...(event.uri ? { uri: event.uri } : {})
    }
  };
}

export async function dispatchOurHangoutInbound(api: any, event: OurHangoutInboundMessage): Promise<void> {
  const envelope = toOpenClawInboundEnvelope(event);
  const dispatch =
    api?.dispatchInboundMessage ??
    api?.runtime?.dispatchInboundMessage ??
    api?.runtime?.messages?.dispatchInboundMessage;

  if (typeof dispatch !== 'function') {
    api?.logger?.warn?.(
      { event },
      'OurHangout channel runtime could not find an OpenClaw inbound dispatch hook'
    );
    return;
  }

  await dispatch(envelope);
}
