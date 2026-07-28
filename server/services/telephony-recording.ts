import {
  onlinePbxClient,
  type OnlinePbxCallHistoryItem,
} from './onlinepbx';

type RecordingClient = Pick<
  typeof onlinePbxClient,
  'getCallHistory' | 'getCallRecordingUrl'
>;

export type OnlinePbxRecordingResolution =
  | {
      state: 'ready';
      url: string;
      providerCallId: string;
      history: OnlinePbxCallHistoryItem | null;
    }
  | {
      state: 'pending';
    }
  | {
      state: 'unavailable';
    };

type RecordingLookupInput = {
  providerCallId: string | null;
  direction?: 'incoming' | 'outgoing' | null;
  phone: string;
  startedAt: string | Date;
};

const MAX_RECORDING_START_SKEW_MS = 90_000;
const AMBIGUOUS_RECORDING_GAP_MS = 15_000;

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const historyMatchesPhone = (item: OnlinePbxCallHistoryItem, phone: string) => {
  const target = digitsOnly(phone);
  return [item.callerIdNumber, item.destinationNumber, ...item.events.map((event) => event.number)]
    .some((value) => digitsOnly(value) === target);
};

const normalizeDirection = (value: unknown): 'incoming' | 'outgoing' | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['incoming', 'inbound', 'in'].includes(normalized)) return 'incoming';
  if (['outgoing', 'outbound', 'out'].includes(normalized)) return 'outgoing';
  return null;
};

export const resolveOnlinePbxRecording = async (
  call: RecordingLookupInput,
  client: RecordingClient = onlinePbxClient,
): Promise<OnlinePbxRecordingResolution> => {
  const providerCallId = call.providerCallId?.trim() || null;
  if (providerCallId) {
    const url = await client.getCallRecordingUrl(providerCallId);
    if (url) {
      return {
        state: 'ready',
        url,
        providerCallId,
        history: null,
      };
    }
  }

  const startedAt = new Date(call.startedAt).getTime();
  const history = await client.getCallHistory({
    phoneNumbers: call.phone,
    startStampFrom: Math.floor(startedAt / 1000) - 180,
    startStampTo: Math.floor(startedAt / 1000) + 300,
  });
  const callDirection = normalizeDirection(call.direction);
  const candidates = history
    .filter((item) => {
      if (!historyMatchesPhone(item, call.phone)) return false;
      if (Math.abs(item.startStamp * 1000 - startedAt) > MAX_RECORDING_START_SKEW_MS) {
        return false;
      }
      const historyDirection = normalizeDirection(item.direction);
      return !callDirection || !historyDirection || callDirection === historyDirection;
    })
    .sort(
      (left, right) =>
        Math.abs(left.startStamp * 1000 - startedAt)
        - Math.abs(right.startStamp * 1000 - startedAt),
    );
  const nearestGap = candidates[0]
    ? Math.abs(candidates[0].startStamp * 1000 - startedAt)
    : Number.POSITIVE_INFINITY;
  const nextGap = candidates[1]
    ? Math.abs(candidates[1].startStamp * 1000 - startedAt)
    : Number.POSITIVE_INFINITY;
  const match = nextGap - nearestGap < AMBIGUOUS_RECORDING_GAP_MS
    ? undefined
    : candidates[0];
  if (!match) return { state: 'pending' };

  const url = await client.getCallRecordingUrl(match.uuid);
  if (!url) return { state: 'unavailable' };

  return {
    state: 'ready',
    url,
    providerCallId: match.uuid,
    history: match,
  };
};
