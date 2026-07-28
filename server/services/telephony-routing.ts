import type { Pool, PoolClient } from 'pg';
import {
  buildOnlinePbxRoutingPlan,
  buildOnlinePbxRoutingTargets,
  ONLINE_PBX_FALLBACK_RING_GROUP,
  ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
  ONLINE_PBX_RING_GROUP,
  onlinePbxRoutingDestination,
  type OnlinePbxRoutingCandidate,
  type OnlinePbxRoutingPlan,
} from '@shared/telephony';
import { pool } from '../db';
import { logger } from '../lib/logger';
import {
  onlinePbxClient,
  OnlinePbxError,
  type OnlinePbxExtension,
  type OnlinePbxGroup,
} from './onlinepbx';

type Queryable = Pick<Pool | PoolClient, 'query'>;

type ManagerRoutingRow = Omit<OnlinePbxRoutingCandidate, 'isTelephonyReady'> & {
  fullName: string;
  phone: string | null;
};

type PrimaryManagerRow = {
  primaryManagerId: number | null;
};

export type OnlinePbxManagerRoutingSetting = {
  id: number;
  fullName: string;
  phone: string | null;
  extension: string | null;
  enabled: boolean;
  isOnline: boolean;
  isProviderEnabled: boolean;
  isRegistered: boolean;
  isTelephonyReady: boolean;
  hasValidExtension: boolean;
  isPrimary: boolean;
  isActivePrimary: boolean;
};

export type OnlinePbxRoutingSettings = {
  ringDelaySeconds: number;
  primaryManagerId: number | null;
  activePrimaryManagerId: number | null;
  enabledManagerIds: number[];
  managers: OnlinePbxManagerRoutingSetting[];
  synchronized?: boolean;
};

const loadManagerRoutingRows = async (
  executor: Queryable = pool,
): Promise<ManagerRoutingRow[]> => {
  const result = await executor.query<ManagerRoutingRow>(
    `SELECT manager.id,
            manager.full_name AS "fullName",
            manager.phone,
            manager.online_pbx_extension AS extension,
            manager.online_pbx_incoming_enabled AS enabled,
            COALESCE(manager.is_online, false) AS "isOnline"
     FROM users manager
     WHERE manager.is_active = true
       AND (
         manager.workspace = 'sales'
         OR EXISTS (
           SELECT 1
           FROM user_workspaces workspace
           WHERE workspace.user_id = manager.id
             AND workspace.workspace = 'sales'
         )
       )
     ORDER BY (manager.workspace = 'sales') DESC, manager.full_name, manager.id`,
  );
  return result.rows;
};

const loadPreferredPrimaryManagerId = async (
  executor: Queryable = pool,
): Promise<number | null> => {
  const result = await executor.query<PrimaryManagerRow>(
    `SELECT online_pbx_primary_manager_id AS "primaryManagerId"
     FROM academy_company_settings
     ORDER BY id
     LIMIT 1`,
  );
  const value = Number(result.rows[0]?.primaryManagerId);
  return Number.isInteger(value) && value > 0 ? value : null;
};

const providerExtensionMap = (extensions: OnlinePbxExtension[]) => new Map(
  extensions.map((extension) => [extension.extension, extension]),
);

const loadRoutingState = async (
  executor: Queryable,
  providerExtensions: ReadonlyMap<string, OnlinePbxExtension>,
) => {
  const [managers, primaryManagerId] = await Promise.all([
    loadManagerRoutingRows(executor),
    loadPreferredPrimaryManagerId(executor),
  ]);
  const candidates: OnlinePbxRoutingCandidate[] = managers.map((manager) => ({
    id: manager.id,
    extension: manager.extension,
    enabled: manager.enabled,
    isOnline: manager.isOnline,
    isTelephonyReady: Boolean(
      manager.extension
      && providerExtensions.get(manager.extension)?.enabled
      && providerExtensions.get(manager.extension)?.registered,
    ),
  }));
  const plan = buildOnlinePbxRoutingPlan(candidates, primaryManagerId);
  return { managers, primaryManagerId, candidates, plan };
};

export const getOnlinePbxRoutingSettings = async (
  executor: Queryable = pool,
): Promise<OnlinePbxRoutingSettings> => {
  let providerExtensions: OnlinePbxExtension[] = [];
  let synchronized = true;
  try {
    providerExtensions = await onlinePbxClient.listExtensions();
  } catch (error) {
    synchronized = false;
    logger.warn('Could not load OnlinePBX extension registration state', { error });
  }

  const extensionsByNumber = providerExtensionMap(providerExtensions);
  const { managers, primaryManagerId, candidates, plan } = await loadRoutingState(
    executor,
    extensionsByNumber,
  );
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const activePrimaryManagerId = plan.primary?.id ?? null;

  return {
    ringDelaySeconds: ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
    primaryManagerId,
    activePrimaryManagerId,
    enabledManagerIds: managers.filter((manager) => manager.enabled).map((manager) => manager.id),
    managers: managers.map((manager) => {
      const candidate = candidatesById.get(manager.id)!;
      const providerExtension = manager.extension
        ? extensionsByNumber.get(manager.extension)
        : undefined;
      return {
        id: manager.id,
        fullName: manager.fullName,
        phone: manager.phone,
        extension: manager.extension,
        enabled: manager.enabled,
        isOnline: manager.isOnline,
        isProviderEnabled: Boolean(providerExtension?.enabled),
        isRegistered: Boolean(providerExtension?.registered),
        isTelephonyReady: candidate.isTelephonyReady,
        hasValidExtension: Boolean(onlinePbxRoutingDestination(manager.extension)),
        isPrimary: manager.id === primaryManagerId,
        isActivePrimary: manager.id === activePrimaryManagerId,
      };
    }),
    synchronized,
  };
};

const groupRoutingMatches = (
  current: OnlinePbxGroup,
  next: OnlinePbxGroup,
) => (
  current.delay === next.delay
  && current.defaultDestination === next.defaultDestination
  && current.users.length === next.users.length
  && current.users.every((member, index) => member === next.users[index])
);

const ensureFallbackGroup = async (plan: OnlinePbxRoutingPlan) => {
  const targets = buildOnlinePbxRoutingTargets(plan);
  const current = await onlinePbxClient.findGroup(ONLINE_PBX_FALLBACK_RING_GROUP);
  const next: OnlinePbxGroup = {
    extension: ONLINE_PBX_FALLBACK_RING_GROUP,
    name: current?.name ?? 'CRM Backup Managers',
    users: targets.fallbackUsers,
    delay: targets.fallbackDelay,
    defaultDestination: null,
  };

  if (!current) {
    if (plan.fallback.length > 0) await onlinePbxClient.createGroup(next);
    return;
  }
  if (!groupRoutingMatches(current, next)) {
    await onlinePbxClient.updateGroup(next);
  }
};

const syncOnlinePbxRoutingOnce = async () => {
  if (!onlinePbxClient.isConfigured()) {
    throw new OnlinePbxError('onlinePbxNotConfigured', 503);
  }

  const providerExtensions = await onlinePbxClient.listExtensions();
  const { plan } = await loadRoutingState(
    pool,
    providerExtensionMap(providerExtensions),
  );
  const targets = buildOnlinePbxRoutingTargets(plan);
  await ensureFallbackGroup(plan);

  const currentPrimaryGroup = await onlinePbxClient.getGroup(ONLINE_PBX_RING_GROUP);
  const nextPrimaryGroup: OnlinePbxGroup = {
    ...currentPrimaryGroup,
    users: targets.primaryUsers,
    delay: targets.primaryDelay,
    defaultDestination: targets.primaryDefaultDestination,
  };
  if (!groupRoutingMatches(currentPrimaryGroup, nextPrimaryGroup)) {
    await onlinePbxClient.updateGroup(nextPrimaryGroup);
  }

  logger.info('OnlinePBX internal CRM routing synchronized', {
    primaryManagerId: plan.primary?.id ?? null,
    primaryExtension: plan.primary?.destination ?? null,
    fallbackManagerIds: plan.fallback.map((manager) => manager.id),
    fallbackExtensions: plan.fallback.map((manager) => manager.destination),
  });
  return plan;
};

let synchronizationQueue: Promise<unknown> = Promise.resolve();

export const synchronizeOnlinePbxRouting = () => {
  const operation = synchronizationQueue
    .catch(() => undefined)
    .then(syncOnlinePbxRoutingOnce);
  synchronizationQueue = operation;
  return operation;
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  const timeout = setTimeout(resolve, milliseconds);
  timeout.unref();
});

export const synchronizeOnlinePbxRoutingWithRetry = async (attempts = 3) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await synchronizeOnlinePbxRouting();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 250);
    }
  }
  throw lastError;
};

export const queueOnlinePbxRoutingSync = () => {
  void synchronizeOnlinePbxRoutingWithRetry(2).catch((error) => {
    logger.error('Failed to synchronize OnlinePBX internal CRM routing', { error });
  });
};
