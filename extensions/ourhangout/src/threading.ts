export type OurHangoutDirectTarget = {
  roomId: string;
  pobiId: string;
  sessionKey: string;
};

export function buildDirectSessionKey(roomId: string, pobiId: string, prefix = 'ourhangout:direct'): string {
  return `${prefix}:${roomId}:${pobiId}`;
}

export function parseDirectSessionKey(raw: string): OurHangoutDirectTarget | null {
  const trimmed = raw.trim();
  const match = /^ourhangout:direct:([^:]+):([^:]+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    roomId: match[1],
    pobiId: match[2],
    sessionKey: trimmed
  };
}

export function resolveOutboundTarget(raw: string, fallbackPobiId: string): OurHangoutDirectTarget {
  const parsed = parseDirectSessionKey(raw);
  if (parsed) {
    return parsed;
  }

  return {
    roomId: raw.trim(),
    pobiId: fallbackPobiId,
    sessionKey: buildDirectSessionKey(raw.trim(), fallbackPobiId)
  };
}

export const ourHangoutThreading = {
  topLevelReplyToMode: 'reply' as const
};
