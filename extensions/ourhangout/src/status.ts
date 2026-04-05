export type OurHangoutRuntimeStatus = {
  accountId: string;
  transport: 'idle' | 'polling' | 'websocket';
  afterOrderSeq: number;
  running: boolean;
  stateFile?: string;
  lastSyncAt?: string;
  lastMessageAt?: string;
};

export function createOurHangoutRuntimeStatus(input: OurHangoutRuntimeStatus): OurHangoutRuntimeStatus {
  return input;
}
