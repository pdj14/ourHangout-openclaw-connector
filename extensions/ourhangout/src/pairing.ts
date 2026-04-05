import { OurHangoutClient, type OurHangoutRegistrationInput, type OurHangoutRegistrationResult } from './client.js';

export async function pairOurHangoutChannel(input: OurHangoutRegistrationInput): Promise<OurHangoutRegistrationResult> {
  const client = new OurHangoutClient(input.serverBaseUrl);
  return client.registerChannel(input);
}

export function createSuggestedDeviceKey(prefix = 'ourhangout'): string {
  return `${prefix}-${Date.now()}`;
}
