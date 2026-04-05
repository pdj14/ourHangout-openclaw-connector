export const ourHangoutSecurity = {
  dm: {
    channelKey: 'ourhangout',
    resolvePolicy: (account: { dmPolicy?: string }) => account.dmPolicy ?? 'open',
    resolveAllowFrom: (account: { allowFrom?: string[] }) => account.allowFrom ?? [],
    defaultPolicy: 'open'
  }
};
