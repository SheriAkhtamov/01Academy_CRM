export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_SHARED_EXTENSION = '100' as const;
export const ONLINE_PBX_RING_GROUP = '10' as const;
export const ONLINE_PBX_FALLBACK_RING_GROUP = '11' as const;
export const ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS = 3 as const;
export const ONLINE_PBX_FALLBACK_RING_DELAY_SECONDS = 20 as const;
export const ONLINE_PBX_HANGUP_DESTINATION = '0' as const;
export const ONLINE_PBX_DEFAULT_FORWARDING_NUMBER = '+998978576040' as const;
export const ONLINE_PBX_TRUNK_NUMBER = '998787070171' as const;

const phoneDigits = (value: string | null | undefined) =>
  String(value ?? '').replace(/\D/g, '');

export type OnlinePbxRoutingCandidate = {
  id: number;
  phone: string | null;
  enabled: boolean;
  isOnline: boolean;
};

export type OnlinePbxRoutingManager = OnlinePbxRoutingCandidate & {
  destination: string;
};

export type OnlinePbxRoutingPlan = {
  primary: OnlinePbxRoutingManager | null;
  fallback: OnlinePbxRoutingManager[];
};

export type OnlinePbxRoutingTargets = {
  primaryUsers: string[];
  primaryDelay: number;
  primaryDefaultDestination: string | null;
  fallbackUsers: string[];
  fallbackDelay: number;
};

export const onlinePbxRoutingDestination = (
  value: string | null | undefined,
): string | null => {
  const digits = phoneDigits(value);
  const normalized = digits.length === 9 ? `998${digits}` : digits;
  if (
    normalized.length < 7
    || normalized.length > 15
    || normalized === ONLINE_PBX_TRUNK_NUMBER
  ) {
    return null;
  }
  return normalized;
};

export const buildOnlinePbxRoutingPlan = (
  candidates: OnlinePbxRoutingCandidate[],
  preferredPrimaryManagerId: number | null,
): OnlinePbxRoutingPlan => {
  const ordered = candidates
    .filter((candidate) => candidate.enabled && candidate.isOnline)
    .map((candidate) => ({
      ...candidate,
      destination: onlinePbxRoutingDestination(candidate.phone),
    }))
    .filter((candidate): candidate is OnlinePbxRoutingManager => Boolean(candidate.destination))
    .sort((left, right) => {
      if (left.id === preferredPrimaryManagerId) return -1;
      if (right.id === preferredPrimaryManagerId) return 1;
      return left.id - right.id;
    });

  const seenDestinations = new Set<string>();
  const uniqueManagers = ordered.filter((candidate) => {
    if (seenDestinations.has(candidate.destination)) return false;
    seenDestinations.add(candidate.destination);
    return true;
  });

  return {
    primary: uniqueManagers[0] ?? null,
    fallback: uniqueManagers.slice(1),
  };
};

export const buildOnlinePbxRoutingTargets = (
  plan: OnlinePbxRoutingPlan,
): OnlinePbxRoutingTargets => ({
  primaryUsers: [plan.primary?.destination ?? ONLINE_PBX_HANGUP_DESTINATION],
  primaryDelay: plan.primary
    ? plan.fallback.length > 0
      ? ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS
      : ONLINE_PBX_FALLBACK_RING_DELAY_SECONDS
    : 1,
  primaryDefaultDestination: plan.fallback.length > 0
    ? ONLINE_PBX_FALLBACK_RING_GROUP
    : null,
  fallbackUsers: plan.fallback.length > 0
    ? plan.fallback.map((manager) => manager.destination)
    : [ONLINE_PBX_HANGUP_DESTINATION],
  fallbackDelay: ONLINE_PBX_FALLBACK_RING_DELAY_SECONDS,
});

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
