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
  phone: string;
  startedAt: string | Date;
};

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const historyMatchesPhone = (item: OnlinePbxCallHistoryItem, phone: string) => {
  const target = digitsOnly(phone);
  return [item.callerIdNumber, item.destinationNumber, ...item.events.map((event) => event.number)]
    .some((value) => digitsOnly(value) === target);
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
  const match = history
    .filter((item) => historyMatchesPhone(item, call.phone))
    .sort(
      (left, right) =>
        Math.abs(left.startStamp * 1000 - startedAt)
        - Math.abs(right.startStamp * 1000 - startedAt),
    )[0];
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
