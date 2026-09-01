import {
  getAssignedModules,
  hasLeadershipAccess,
  type AcademyAccessModule,
  type ModuleAccessSource,
} from '@shared/academy';

export type ActorContext = {
  userId: number;
  primaryModule: AcademyAccessModule | null;
  modules: readonly AcademyAccessModule[];
  isLeadership: boolean;
  displayName?: string;
};

type ActorIdentitySource = {
  id?: number | null;
  module?: string | null;
  modules?: readonly string[] | null;
};

export type ActorSource = string | readonly string[] | ActorIdentitySource | {
  user?: ActorIdentitySource | null;
  userId?: number | null;
  primaryModule?: string | null;
} | null | undefined;

const sourceUser = (source: ActorSource) => (
  source && typeof source === 'object' && !Array.isArray(source) && 'user' in source
    ? source.user
    : source
);

export const actorContextFrom = (source: ActorSource): ActorContext => {
  const user = sourceUser(source);
  const modules = getAssignedModules(user as ModuleAccessSource);
  const sourceRecord = source && typeof source === 'object' && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
  const userRecord = user && typeof user === 'object' && !Array.isArray(user)
    ? user as Record<string, unknown>
    : {};
  const userId = Number(
    userRecord.id
    ?? sourceRecord.userId
    ?? 0,
  );
  const primaryCandidate = String(
    userRecord.module
    ?? sourceRecord.primaryModule
    ?? '',
  );

  return {
    userId: Number.isInteger(userId) && userId > 0 ? userId : 0,
    primaryModule: modules.includes(primaryCandidate as AcademyAccessModule)
      ? primaryCandidate as AcademyAccessModule
      : modules[0] ?? null,
    modules,
    isLeadership: hasLeadershipAccess(user as ModuleAccessSource),
    ...(typeof userRecord.fullName === 'string' && userRecord.fullName.trim()
      ? { displayName: userRecord.fullName.trim() }
      : {}),
  };
};
