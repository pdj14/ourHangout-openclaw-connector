import { resolveOurHangoutAccount, type OurHangoutResolvedAccount } from './config.js';

export type OurHangoutRegistrationInput = {
  serverBaseUrl: string;
  pairingCode: string;
  deviceKey: string;
  deviceName?: string;
  platform?: string;
};

export type OurHangoutRegistrationResult = {
  accountId: string;
  ownerUserId: string;
  pobiId: string;
  botKey: string;
  authToken: string;
  wsUrl: string;
  syncUrl: string;
  messagesUrl: string;
  sessionKeyPrefix: string;
};

export type OurHangoutInboundMessage = {
  accountId: string;
  sessionKey: string;
  roomId: string;
  roomType: 'direct';
  pobiId: string;
  botKey: string;
  botUserId: string;
  senderUserId: string;
  messageId: string;
  kind: 'text' | 'image' | 'video' | 'system';
  text?: string;
  uri?: string;
  replyToMessageId?: string;
  orderSeq: number;
  createdAt: string;
};

export type OurHangoutSyncResponse = {
  items: OurHangoutInboundMessage[];
  nextAfterOrderSeq: number;
  hasMore: boolean;
};

export type OurHangoutSendMessageResult = {
  id?: string;
};

type WebSocketEventPayload = {
  data?: unknown;
};

type WebSocketLike = {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener?: (event: string, handler: (payload: WebSocketEventPayload) => void) => void;
  onopen?: (() => void) | null;
  onmessage?: ((payload: WebSocketEventPayload) => void) | null;
  onerror?: ((payload: unknown) => void) | null;
  onclose?: (() => void) | null;
};

type WebSocketFactory = new (url: string) => WebSocketLike;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function getGlobalWebSocketFactory(): WebSocketFactory | null {
  const candidate = (globalThis as { WebSocket?: WebSocketFactory }).WebSocket;
  return typeof candidate === 'function' ? candidate : null;
}

async function parseJson(response: Response): Promise<unknown> {
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

function unwrapDataEnvelope<T>(payload: unknown): T {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  return (record.data ?? record) as T;
}

function createAuthHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  return headers;
}

export class OurHangoutClient {
  constructor(
    public readonly serverBaseUrl: string,
    public readonly wsUrl?: string,
    public readonly authToken?: string
  ) {}

  static fromAccount(account: OurHangoutResolvedAccount): OurHangoutClient {
    return new OurHangoutClient(account.serverBaseUrl, account.wsUrl, account.authToken);
  }

  static fromConfig(cfg: unknown, accountId?: string | null): OurHangoutClient {
    const account = resolveOurHangoutAccount(cfg as any, accountId);
    return OurHangoutClient.fromAccount(account);
  }

  async registerChannel(input: OurHangoutRegistrationInput): Promise<OurHangoutRegistrationResult> {
    const response = await fetch(`${normalizeBaseUrl(input.serverBaseUrl)}/v1/openclaw/channel/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        pairingCode: input.pairingCode,
        deviceKey: input.deviceKey,
        deviceName: input.deviceName,
        platform: input.platform ?? 'linux'
      })
    });

    const parsed = await parseJson(response);
    if (!response.ok) {
      throw new Error(`ourhangout: register failed (${response.status})`);
    }

    return unwrapDataEnvelope<OurHangoutRegistrationResult>(parsed);
  }

  async syncMessages(params: {
    afterOrderSeq?: number;
    limit?: number;
    pobiId?: string;
  }): Promise<OurHangoutSyncResponse> {
    if (!this.authToken) {
      throw new Error('ourhangout: authToken is required for sync');
    }

    const url = new URL(`${normalizeBaseUrl(this.serverBaseUrl)}/v1/openclaw/channel/messages/sync`);
    if (typeof params.afterOrderSeq === 'number') {
      url.searchParams.set('afterOrderSeq', String(Math.max(0, Math.floor(params.afterOrderSeq))));
    }
    if (typeof params.limit === 'number') {
      url.searchParams.set('limit', String(Math.max(1, Math.floor(params.limit))));
    }
    if (params.pobiId) {
      url.searchParams.set('pobiId', params.pobiId);
    }

    const response = await fetch(url, {
      headers: createAuthHeaders(this.authToken)
    });
    const parsed = await parseJson(response);
    if (!response.ok) {
      throw new Error(`ourhangout: sync failed (${response.status})`);
    }

    return unwrapDataEnvelope<OurHangoutSyncResponse>(parsed);
  }

  async sendMessage(params: {
    roomId: string;
    pobiId: string;
    text: string;
    clientMessageId?: string;
    replyToMessageId?: string;
  }): Promise<OurHangoutSendMessageResult> {
    if (!this.authToken) {
      throw new Error('ourhangout: authToken is required for outbound send');
    }

    const response = await fetch(`${normalizeBaseUrl(this.serverBaseUrl)}/v1/openclaw/channel/messages`, {
      method: 'POST',
      headers: {
        ...createAuthHeaders(this.authToken),
        'content-type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    const parsed = await parseJson(response);
    if (!response.ok) {
      throw new Error(`ourhangout: send failed (${response.status})`);
    }

    return unwrapDataEnvelope<OurHangoutSendMessageResult>(parsed);
  }

  connectWebSocket(params: {
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: unknown) => void;
    onMessage: (message: OurHangoutInboundMessage) => void;
    hello?: {
      pobiIds?: string[];
      botKeys?: string[];
    };
  }): WebSocketLike {
    if (!this.authToken) {
      throw new Error('ourhangout: authToken is required for websocket connect');
    }

    const Factory = getGlobalWebSocketFactory();
    if (!Factory) {
      throw new Error('ourhangout: global WebSocket implementation is not available');
    }

    const socket = new Factory(`${this.getChannelWsUrl()}?token=${encodeURIComponent(this.authToken)}`);
    const onMessage = (payload: WebSocketEventPayload) => {
      const raw = typeof payload?.data === 'string' ? payload.data : '';
      if (!raw) {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed.event !== 'ourhangout.message') {
        return;
      }

      params.onMessage(unwrapDataEnvelope<OurHangoutInboundMessage>(parsed));
    };

    const emitHello = () => {
      if (!params.hello) {
        return;
      }

      socket.send(
        JSON.stringify({
          event: 'channel.hello',
          data: params.hello
        })
      );
    };

    if (socket.addEventListener) {
      socket.addEventListener('open', () => {
        emitHello();
        params.onOpen?.();
      });
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', (event) => {
        params.onError?.(event);
      });
      socket.addEventListener('close', () => {
        params.onClose?.();
      });
      return socket;
    }

    socket.onopen = () => {
      emitHello();
      params.onOpen?.();
    };
    socket.onmessage = onMessage;
    socket.onerror = (event) => {
      params.onError?.(event);
    };
    socket.onclose = () => {
      params.onClose?.();
    };
    return socket;
  }

  private getChannelWsUrl(): string {
    const configuredWsUrl = this.wsUrl?.trim();
    if (configuredWsUrl) {
      return configuredWsUrl.replace(/\/+$/, '');
    }

    const baseUrl = normalizeBaseUrl(this.serverBaseUrl);
    if (/^https:/i.test(baseUrl)) {
      return `${baseUrl.replace(/^https:/i, 'wss:')}/v1/openclaw/channel/ws`;
    }
    if (/^http:/i.test(baseUrl)) {
      return `${baseUrl.replace(/^http:/i, 'ws:')}/v1/openclaw/channel/ws`;
    }
    return `${baseUrl}/v1/openclaw/channel/ws`;
  }
}
