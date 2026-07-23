export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_SHARED_EXTENSION = '100' as const;

export const sharedCallEventClaimsOwnership = (input: {
  direction: 'incoming' | 'outgoing';
  status: string;
  talkSeconds?: unknown;
}) => {
  const talkSeconds = Number(input.talkSeconds);
  return input.direction === 'outgoing'
    || input.status === 'connected'
    || (Number.isFinite(talkSeconds) && talkSeconds > 0);
};

export const isOnlinePbxExtension = (value: unknown): value is string => {
  const text = String(value ?? '').trim();
  if (!/^\d{3,4}$/.test(text)) return false;
  const extension = Number(text);
  return Number.isInteger(extension)
    && extension >= ONLINE_PBX_EXTENSION_MIN
    && extension <= ONLINE_PBX_EXTENSION_MAX;
};
