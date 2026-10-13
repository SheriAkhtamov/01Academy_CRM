import type { OnlinePbxClient } from '../../services/onlinepbx';
import type { VoiceReminderCapacityProvider } from '../voice-reminders-runtime';
import type { ProviderChannelSnapshot } from './channel-reservations';
import type { PoolClient } from 'pg';

/** Capacity is supplied by the configured call source; credentials stay server-side. */
export const createPbxCapacityProvider = (
  client: OnlinePbxClient,
  readCapacity?: () => Promise<ProviderChannelSnapshot>,
  readLocked?: (connection: PoolClient, excludeReservationId?: string) => Promise<ProviderChannelSnapshot>,
): VoiceReminderCapacityProvider => ({
  async snapshot() {
    // Extension BLF and completed history alone cannot authorize a dial.
    if (!client.isConfigured() || !readCapacity) return { known: false, occupiedChannels: 0, busyExtensions: [] };
    const snapshot = await readCapacity();
    if (!snapshot.known || !Number.isInteger(snapshot.occupiedChannels) || snapshot.occupiedChannels < 0
      || !snapshot.busyExtensions.every(extension => /^\d{2,10}$/.test(extension))) {
      return { known: false, occupiedChannels: 0, busyExtensions: [] };
    }
    return snapshot;
  },
  getCredentials: extension => client.getWebRtcCredentials(extension),
  ...(readLocked ? { readLocked } : {}),
});
