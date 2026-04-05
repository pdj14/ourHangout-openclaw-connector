declare module 'openclaw/plugin-sdk/channel-core' {
  export type OpenClawConfig = any;

  export function createChannelPluginBase(input: any): any;
  export function createChatChannelPlugin<T = any>(input: any): any;
  export function defineChannelPluginEntry(input: any): any;
  export function defineSetupPluginEntry(input: any): any;
}
