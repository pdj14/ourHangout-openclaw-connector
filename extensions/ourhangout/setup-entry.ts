import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { ourHangoutChannelPlugin } from './src/channel.js';

export default defineSetupPluginEntry(ourHangoutChannelPlugin);
