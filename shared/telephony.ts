export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;
export const ONLINE_PBX_LEGACY_SHARED_EXTENSION = '100' as const;
export const ONLINE_PBX_UNIQUE_EXTENSION_MIN = 101;
export const ONLINE_PBX_RING_GROUP = '10' as const;
export const ONLINE_PBX_FALLBACK_RING_GROUP = '11' as const;
export const ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS = 3 as const;
export const ONLINE_PBX_FALLBACK_RING_DELAY_SECONDS = 20 as const;
export const ONLINE_PBX_HANGUP_DESTINATION = '0' as const;
export const ONLINE_PBX_TRUNK_NUMBER = '998787070171' as const;

export type OnlinePbxRoutingCandidate = {
  id: number;
  extension: string | null;
  enabled: boolean;
  isOnline: boolean;
  isTelephonyReady: boolean;
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
  const extension = String(value ?? '').trim();
  return isOnlinePbxExtension(extension)
    && extension !== ONLINE_PBX_LEGACY_SHARED_EXTENSION
    ? extension
    : null;
};

export const buildOnlinePbxRoutingPlan = (
  candidates: OnlinePbxRoutingCandidate[],
  preferredPrimaryManagerId: number | null,
): OnlinePbxRoutingPlan => {
  const ordered = candidates
    .filter((candidate) => (
      candidate.enabled
      && candidate.isOnline
      && candidate.isTelephonyReady
    ))
    .map((candidate) => ({
      ...candidate,
      destination: onlinePbxRoutingDestination(candidate.extension),
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
