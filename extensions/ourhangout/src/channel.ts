import { createChatChannelPlugin, createChannelPluginBase } from 'openclaw/plugin-sdk/core';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import {
  getOurHangoutChannelConfig,
  inspectOurHangoutAccount,
  listOurHangoutAccountIds,
  resolveOurHangoutAccount,
  type OurHangoutResolvedAccount
} from './config.js';
import { ourHangoutOutbound } from './outbound.js';
import { ourHangoutSecurity } from './security.js';
import { ourHangoutThreading } from './threading.js';

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): OurHangoutResolvedAccount {
  return resolveOurHangoutAccount(cfg, accountId);
}

function defaultAccountId(cfg: OpenClawConfig): string {
  const section = getOurHangoutChannelConfig(cfg);
  const configuredDefault = typeof section.defaultAccount === 'string' ? section.defaultAccount.trim() : '';
  if (configuredDefault) {
    return configuredDefault;
  }

  return listOurHangoutAccountIds(cfg)[0] ?? 'default';
}

export const ourHangoutChannelPlugin = createChatChannelPlugin<OurHangoutResolvedAccount>({
  base: createChannelPluginBase({
    id: 'ourhangout',
    setup: {
      resolveAccount,
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null) {
        return inspectOurHangoutAccount(cfg, accountId);
      }
    },
    config: {
      listAccountIds: listOurHangoutAccountIds,
      resolveAccount,
      defaultAccountId,
      isEnabled: (_account: OurHangoutResolvedAccount, cfg: OpenClawConfig) => listOurHangoutAccountIds(cfg).length > 0,
      isConfigured: (account: OurHangoutResolvedAccount) =>
        !!account.serverBaseUrl && !!account.authToken && !!account.accountId && !!account.pobiId && !!account.botKey
    }
  }),
  security: ourHangoutSecurity,
  threading: ourHangoutThreading,
  outbound: ourHangoutOutbound
});
