export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_SHARED_EXTENSION = '100' as const;
export const ONLINE_PBX_RING_GROUP = '10' as const;
export const ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS = 3 as const;
export const ONLINE_PBX_GROUP_RING_DELAY_SECONDS = 20 as const;
export const ONLINE_PBX_HANGUP_DESTINATION = '0' as const;
export const ONLINE_PBX_TRUNK_NUMBER = '998787070171' as const;

export type OnlinePbxRoutingCandidate = {
  id: number;
  extension: string | null;
  enabled: boolean;
  isOnline: boolean;
  isTelephonyReady: boolean;
};

export const onlinePbxRoutingDestination = (
  value: string | null | undefined,
): string | null => {
  const extension = String(value ?? '').trim();
  return isOnlinePbxExtension(extension) ? extension : null;
};

export type OnlinePbxManagerAssignment = {
  onlinePbxExtension?: string | null;
  onlinePbxIncomingEnabled?: boolean | null;
};

export const hasOnlinePbxManagerAssignment = (
  user: OnlinePbxManagerAssignment | null | undefined,
): boolean => Boolean(
  user?.onlinePbxIncomingEnabled
  && onlinePbxRoutingDestination(user.onlinePbxExtension),
);

const phoneDigits = (value: string | null | undefined) =>
  String(value ?? '').replace(/\D/g, '');

export const buildOnlinePbxRingMembers = (
  candidates: OnlinePbxRoutingCandidate[],
  forwarding: { enabled: boolean; phone: string | null },
): string[] => {
  const members = candidates
    .filter((candidate) => (
      candidate.enabled
      && candidate.isOnline
      && candidate.isTelephonyReady
    ))
    .map((candidate) => onlinePbxRoutingDestination(candidate.extension))
    .filter((extension): extension is string => Boolean(extension));

  const forwardingNumber = forwarding.enabled ? phoneDigits(forwarding.phone) : '';
  if (forwardingNumber.length >= 7) members.push(forwardingNumber);

  const uniqueMembers = [...new Set(members)];
  return uniqueMembers.length > 0 ? uniqueMembers : [ONLINE_PBX_HANGUP_DESTINATION];
};

export const onlinePbxIncomingDelayMs = (
  managerId: number,
  primaryManagerId: number | null,
) => managerId === primaryManagerId
  ? 0
  : ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS * 1_000;

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
