import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { ourHangoutChannelPlugin } from './src/channel.js';
import { registerOurHangoutRuntimeService } from './src/runtime.js';

export default defineChannelPluginEntry({
  id: 'ourhangout',
  name: 'OurHangout',
  description: 'Connects OpenClaw to OurHangout Pobi direct chats',
  plugin: ourHangoutChannelPlugin,
  registerCliMetadata(api: any) {
    api.registerCli?.(
      ({ program }: any) => {
        program.command('ourhangout').description('OurHangout channel management');
      },
      {
        descriptors: [
          {
            name: 'ourhangout',
            description: 'OurHangout channel management',
            hasSubcommands: false
          }
        ]
      }
    );
  },
  registerFull(api: any) {
    registerOurHangoutRuntimeService(api);
  }
});
