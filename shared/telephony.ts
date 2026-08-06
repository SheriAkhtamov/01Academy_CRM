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

export type OnlinePbxExtensionHolder = {
  id: number;
  extension: string | null;
};

/**
 * An extension names an employee only while it belongs to exactly one of them.
 * Every manager shares the single company extension, so the number the provider
 * reports says nothing about who was on the line and must never pick a winner —
 * otherwise every call lands on whichever manager happens to sort first.
 */
export const onlinePbxExclusiveExtensionHolder = <T extends OnlinePbxExtensionHolder>(
  holders: readonly T[],
): T | null => (holders.length === 1 ? holders[0] : null);

/**
 * How long a call the CRM recorded stays open to be matched with the provider's
 * own report of it. The CRM writes its row when the manager dials or answers;
 * OnlinePBX reports the call once it is over and under its own identifier, so
 * the two are matched on the phone number, the direction and this window. It
 * has to outlast a ring group cycle and a normal conversation, while staying
 * short enough that a customer calling back is not folded into the first call.
 */
export const ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS = 900 as const;

export const isOnlinePbxExtension = (value: unknown): value is string => {
  const text = String(value ?? '').trim();
  if (!/^\d{3,4}$/.test(text)) return false;
  const extension = Number(text);
  return Number.isInteger(extension)
    && extension >= ONLINE_PBX_EXTENSION_MIN
    && extension <= ONLINE_PBX_EXTENSION_MAX;
};
