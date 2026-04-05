import { type OurHangoutInboundMessage } from './client.js';
import { OurHangoutClient } from './client.js';
import { listOurHangoutAccountIds, resolveOurHangoutAccount, type OurHangoutResolvedAccount } from './config.js';
import { dispatchOurHangoutInbound } from './inbound.js';
import { loadOurHangoutState, resolveOurHangoutStateFile, saveOurHangoutState } from './state.js';
import { createOurHangoutRuntimeStatus, type OurHangoutRuntimeStatus } from './status.js';

type RuntimeLogger = {
  info?: (message: string | Record<string, unknown>, ...args: unknown[]) => void;
  warn?: (message: string | Record<string, unknown>, ...args: unknown[]) => void;
  error?: (message: string | Record<string, unknown>, ...args: unknown[]) => void;
  child?: (bindings: Record<string, unknown>) => RuntimeLogger;
};

type WebSocketHandle = {
  close(code?: number, reason?: string): void;
};

function createLogger(api: any, accountId: string): RuntimeLogger {
  return api?.logger?.child?.({ channel: 'ourhangout', accountId }) ?? api?.logger ?? console;
}

export class OurHangoutRuntimeWorker {
  private readonly client: OurHangoutClient;
  private readonly stateFilePath: string;
  private afterOrderSeq = 0;
  private transport: OurHangoutRuntimeStatus['transport'] = 'idle';
  private running = false;
  private lastSyncAt?: string;
  private lastMessageAt?: string;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private socket?: WebSocketHandle;
  private pendingStateWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly account: OurHangoutResolvedAccount,
    private readonly logger: RuntimeLogger
  ) {
    this.client = OurHangoutClient.fromAccount(account);
    this.stateFilePath = resolveOurHangoutStateFile(account);
  }

  async start(handler: (event: OurHangoutInboundMessage) => Promise<void>): Promise<void> {
    await this.loadState();
    this.running = true;
    await this.syncUntilCaughtUp(handler);
    this.tryStartWebSocket(handler);
    if (!this.socket) {
      this.schedulePoll(handler);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.socket?.close(1000, 'shutdown');
    this.socket = undefined;
    this.transport = 'idle';
    await this.pendingStateWrite;
  }

  getStatus(): OurHangoutRuntimeStatus {
    return createOurHangoutRuntimeStatus({
      accountId: this.account.accountId,
      transport: this.transport,
      afterOrderSeq: this.afterOrderSeq,
      running: this.running,
      ...(this.lastSyncAt ? { lastSyncAt: this.lastSyncAt } : {}),
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}),
      stateFile: this.stateFilePath
    });
  }

  private async poll(handler: (event: OurHangoutInboundMessage) => Promise<void>): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      await this.syncUntilCaughtUp(handler);
    } catch (error) {
      this.logger.warn?.({ error }, 'OurHangout polling sync failed');
    } finally {
      this.schedulePoll(handler);
    }
  }

  private schedulePoll(handler: (event: OurHangoutInboundMessage) => Promise<void>): void {
    if (!this.running) {
      return;
    }

    this.transport = 'polling';
    this.pollTimer = setTimeout(() => {
      void this.poll(handler);
    }, this.account.pollIntervalMs);
  }

  private tryStartWebSocket(handler: (event: OurHangoutInboundMessage) => Promise<void>): void {
    try {
      this.socket = this.client.connectWebSocket({
        hello: {
          pobiIds: [this.account.pobiId],
          botKeys: [this.account.botKey]
        },
        onOpen: () => {
          this.transport = 'websocket';
          this.logger.info?.(`OurHangout websocket connected for ${this.account.accountId}`);
        },
        onClose: () => {
          this.socket = undefined;
          if (this.running) {
            this.logger.warn?.(`OurHangout websocket closed for ${this.account.accountId}; switching to polling`);
            this.schedulePoll(handler);
          }
        },
        onError: (error) => {
          this.logger.warn?.({ error }, 'OurHangout websocket error');
        },
        onMessage: (event) => {
          void this.handleInboundEvent(event, handler);
        }
      });
    } catch (error) {
      this.logger.warn?.({ error }, 'OurHangout websocket unavailable; using polling');
    }
  }

  private async syncUntilCaughtUp(handler: (event: OurHangoutInboundMessage) => Promise<void>): Promise<void> {
    let hasMore = true;
    while (this.running && hasMore) {
      const batch = await this.client.syncMessages({
        afterOrderSeq: this.afterOrderSeq,
        pobiId: this.account.pobiId,
        limit: 100
      });

      for (const event of batch.items) {
        await this.handleInboundEvent(event, handler);
      }

      this.afterOrderSeq = Math.max(this.afterOrderSeq, batch.nextAfterOrderSeq);
      hasMore = batch.hasMore;
      this.lastSyncAt = new Date().toISOString();
      this.queuePersistState();
    }
  }

  private async handleInboundEvent(
    event: OurHangoutInboundMessage,
    handler: (event: OurHangoutInboundMessage) => Promise<void>
  ): Promise<void> {
    this.afterOrderSeq = Math.max(this.afterOrderSeq, event.orderSeq);
    this.lastMessageAt = event.createdAt;
    await handler(event);
    this.queuePersistState();
  }

  private async loadState(): Promise<void> {
    const persisted = await loadOurHangoutState(this.account);
    if (!persisted) {
      return;
    }

    this.afterOrderSeq = Math.max(this.afterOrderSeq, persisted.afterOrderSeq);
    this.lastSyncAt = persisted.lastSyncAt;
    this.lastMessageAt = persisted.lastMessageAt;
    this.logger.info?.('Loaded persisted OurHangout channel state', {
      accountId: this.account.accountId,
      afterOrderSeq: this.afterOrderSeq,
      stateFile: this.stateFilePath
    });
  }

  private queuePersistState(): void {
    const snapshot = {
      afterOrderSeq: this.afterOrderSeq,
      lastSyncAt: this.lastSyncAt,
      lastMessageAt: this.lastMessageAt
    };

    this.pendingStateWrite = this.pendingStateWrite
      .catch(() => undefined)
      .then(async () => {
        await saveOurHangoutState(this.account, snapshot);
      })
      .catch((error) => {
        this.logger.warn?.(
          {
            error,
            accountId: this.account.accountId,
            stateFile: this.stateFilePath
          },
          'Failed to persist OurHangout channel state'
        );
      });
  }
}

export function registerOurHangoutRuntimeService(api: any): void {
  const runtimes = new Map<string, OurHangoutRuntimeWorker>();
  const resolveConfig = () => api?.config ?? api?.runtime?.config ?? {};

  api.registerService?.({
    id: 'ourhangout-runtime',
    start: async () => {
      const accountIds = listOurHangoutAccountIds(resolveConfig());
      for (const accountId of accountIds) {
        const account = resolveOurHangoutAccount(resolveConfig(), accountId);
        const logger = createLogger(api, accountId);
        const runtime = new OurHangoutRuntimeWorker(account, logger);
        runtimes.set(accountId, runtime);
        await runtime.start((event) => dispatchOurHangoutInbound(api, event));
      }
    },
    stop: async () => {
      await Promise.all(Array.from(runtimes.values()).map((runtime) => runtime.stop()));
      runtimes.clear();
    }
  });

  api.registerGatewayMethod?.('ourhangout.status', async () => {
    return Array.from(runtimes.values()).map((runtime) => runtime.getStatus());
  });

  api.registerGatewayMethod?.('ourhangout.syncNow', async () => {
    const currentConfig = resolveConfig();
    const results: OurHangoutRuntimeStatus[] = [];
    for (const accountId of listOurHangoutAccountIds(currentConfig)) {
      const existing = runtimes.get(accountId);
      if (existing) {
        results.push(existing.getStatus());
        continue;
      }

      const account = resolveOurHangoutAccount(currentConfig, accountId);
      const logger = createLogger(api, accountId);
      const runtime = new OurHangoutRuntimeWorker(account, logger);
      runtimes.set(accountId, runtime);
      await runtime.start((event) => dispatchOurHangoutInbound(api, event));
      results.push(runtime.getStatus());
    }
    return results;
  });
}
