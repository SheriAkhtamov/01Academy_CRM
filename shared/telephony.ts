export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_SHARED_EXTENSION = '100' as const;
export const ONLINE_PBX_RING_GROUP = '10' as const;
export const ONLINE_PBX_FORWARDING_NUMBER = '998978576040' as const;

export const setOnlinePbxForwardingMember = (
  members: string[],
  enabled: boolean,
): string[] => {
  const normalized = members.map((member) => member.trim()).filter(Boolean);
  const withoutForwarding = normalized.filter(
    (member) => member.replace(/\D/g, '') !== ONLINE_PBX_FORWARDING_NUMBER,
  );
  return enabled
    ? [...new Set([...withoutForwarding, ONLINE_PBX_FORWARDING_NUMBER])]
    : [...new Set(withoutForwarding)];
};

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
