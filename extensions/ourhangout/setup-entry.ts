import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/core';
import { ourHangoutChannelPlugin } from './src/channel.js';

export default defineSetupPluginEntry(ourHangoutChannelPlugin);
