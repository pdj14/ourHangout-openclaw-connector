import { parseArgs } from './openclaw-channel-common.mjs';
import { formatOurHangoutDoctorReport, runOurHangoutDoctor } from './openclaw-channel-doctor.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runOurHangoutDoctor({
    accountAlias: args.account || process.env.OPENCLAW_CHANNEL_ACCOUNT_ALIAS,
    agentId: args.agent || args['agent-id'] || process.env.OPENCLAW_AGENT_ID || 'main',
    configPath: args.config || process.env.OPENCLAW_CONFIG_PATH,
    homeDir: args.home,
    openClawHome: args['openclaw-home'] || process.env.OPENCLAW_HOME
  });

  console.log(formatOurHangoutDoctorReport(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('[ourhangout-channel] doctor failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
