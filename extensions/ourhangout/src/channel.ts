import { createChatChannelPlugin, createChannelPluginBase } from 'openclaw/plugin-sdk/core';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { inspectOurHangoutAccount, resolveOurHangoutAccount, type OurHangoutResolvedAccount } from './config.js';
import { ourHangoutOutbound } from './outbound.js';
import { ourHangoutSecurity } from './security.js';
import { ourHangoutThreading } from './threading.js';

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): OurHangoutResolvedAccount {
  return resolveOurHangoutAccount(cfg, accountId);
}

export const ourHangoutChannelPlugin = createChatChannelPlugin<OurHangoutResolvedAccount>({
  base: createChannelPluginBase({
    id: 'ourhangout',
    setup: {
      resolveAccount,
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null) {
        return inspectOurHangoutAccount(cfg, accountId);
      }
    }
  }),
  security: ourHangoutSecurity,
  threading: ourHangoutThreading,
  outbound: ourHangoutOutbound
});
