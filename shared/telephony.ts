export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_SHARED_EXTENSION = '100' as const;
export const ONLINE_PBX_RING_GROUP = '10' as const;
export const ONLINE_PBX_DEFAULT_FORWARDING_NUMBER = '+998978576040' as const;
export const ONLINE_PBX_TRUNK_NUMBER = '998787070171' as const;

const phoneDigits = (value: string | null | undefined) =>
  String(value ?? '').replace(/\D/g, '');

export const findOnlinePbxForwardingMember = (
  members: string[],
  preferredPhone?: string | null,
): string | null => {
  const normalized = members.map((member) => member.trim()).filter(Boolean);
  const preferredDigits = phoneDigits(preferredPhone);
  if (preferredDigits) {
    const preferredMember = normalized.find(
      (member) => phoneDigits(member) === preferredDigits,
    );
    if (preferredMember) return preferredMember;
  }
  return normalized.find((member) => phoneDigits(member).length >= 7) ?? null;
};

export const setOnlinePbxForwardingMember = (
  members: string[],
  input: {
    enabled: boolean;
    phone: string;
    previousPhone?: string | null;
  },
): string[] => {
  const normalized = members.map((member) => member.trim()).filter(Boolean);
  const previousDigits = phoneDigits(input.previousPhone);
  const nextDigits = phoneDigits(input.phone);
  const withoutForwarding = normalized.filter(
    (member) => !previousDigits || phoneDigits(member) !== previousDigits,
  );
  return input.enabled
    ? [...new Set([...withoutForwarding, nextDigits])]
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
