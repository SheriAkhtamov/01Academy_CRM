import type { OnlinePbxClient } from '../../services/onlinepbx';
import type { VoiceReminderCapacityProvider } from '../voice-reminders-runtime';
import type { ProviderChannelSnapshot } from './channel-reservations';

/** A line is free only when the provider accounts for every external call. */
export const createPbxCapacityProvider = (
  client: OnlinePbxClient,
  readCapacity?: () => Promise<ProviderChannelSnapshot>,
): VoiceReminderCapacityProvider => ({
  async snapshot() {
    // Extension BLF omits Verto calls and calls still in the inbound route.
    // The HTTP history is completed calls only. Neither can authorize a dial.
    if (!client.isConfigured() || !readCapacity) return { known: false, occupiedChannels: 0, busyExtensions: [] };
    const snapshot = await readCapacity();
    if (!snapshot.known || !Number.isInteger(snapshot.occupiedChannels) || snapshot.occupiedChannels < 0
      || !snapshot.busyExtensions.every(extension => /^\d{2,10}$/.test(extension))) {
      return { known: false, occupiedChannels: 0, busyExtensions: [] };
    }
    return snapshot;
  },
  getCredentials: extension => client.getWebRtcCredentials(extension),
});
