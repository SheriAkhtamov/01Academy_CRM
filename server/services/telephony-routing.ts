import type { Pool, PoolClient } from 'pg';
import {
  buildOnlinePbxRingMembers,
  ONLINE_PBX_GROUP_RING_DELAY_SECONDS,
  ONLINE_PBX_HANGUP_DESTINATION,
  ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
  ONLINE_PBX_RING_GROUP,
  onlinePbxIncomingDelayMs,
  onlinePbxRoutingDestination,
  type OnlinePbxRoutingCandidate,
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

type ManagerRoutingRow = {
  id: number;
  fullName: string;
  extension: string | null;
  enabled: boolean;
  isOnline: boolean;
};

type CompanyRoutingRow = {
  primaryManagerId: number | null;
  forwardingPhone: string;
  forwardingEnabled: boolean;
};

export type OnlinePbxManagerOption = {
  id: number;
  fullName: string;
};

export type OnlinePbxManagerAssignment = {
  managerId: number;
  fullName: string;
  extension: string;
  isOnline: boolean;
  isProviderEnabled: boolean;
  isRegistered: boolean;
  isTelephonyReady: boolean;
  isPrimary: boolean;
  isActivePrimary: boolean;
};

export type OnlinePbxRoutingSettings = {
  ringDelaySeconds: number;
  primaryManagerId: number | null;
  activePrimaryManagerId: number | null;
  managers: OnlinePbxManagerOption[];
  assignments: OnlinePbxManagerAssignment[];
  extensions: OnlinePbxExtension[];
  forwarding: {
    enabled: boolean;
    phone: string;
  };
  synchronized?: boolean;
};

const loadManagerRoutingRows = async (
  executor: Queryable = pool,
): Promise<ManagerRoutingRow[]> => {
  const result = await executor.query<ManagerRoutingRow>(
    `SELECT manager.id,
            manager.full_name AS "fullName",
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

const loadCompanyRouting = async (
  executor: Queryable = pool,
): Promise<CompanyRoutingRow> => {
  const result = await executor.query<CompanyRoutingRow>(
    `SELECT online_pbx_primary_manager_id AS "primaryManagerId",
            online_pbx_forwarding_phone AS "forwardingPhone",
            online_pbx_forwarding_enabled AS "forwardingEnabled"
     FROM academy_company_settings
     ORDER BY id
     LIMIT 1`,
  );
  return result.rows[0] ?? {
    primaryManagerId: null,
    forwardingPhone: '',
    forwardingEnabled: false,
  };
};

const providerExtensionMap = (extensions: OnlinePbxExtension[]) => new Map(
  extensions.map((extension) => [extension.extension, extension]),
);

const getActivePrimaryManagerId = (
  assignments: ManagerRoutingRow[],
  preferredManagerId: number | null,
  providerExtensions: ReadonlyMap<string, OnlinePbxExtension>,
) => {
  const available = assignments.filter((manager) => {
    const extension = manager.extension
      ? providerExtensions.get(manager.extension)
      : undefined;
    return manager.enabled && manager.isOnline && Boolean(extension?.enabled);
  });
  return available.find((manager) => manager.id === preferredManagerId)?.id
    ?? available[0]?.id
    ?? null;
};

export const getOnlinePbxRoutingSettings = async (
  executor: Queryable = pool,
): Promise<OnlinePbxRoutingSettings> => {
  const [managers, company] = await Promise.all([
    loadManagerRoutingRows(executor),
    loadCompanyRouting(executor),
  ]);

  let extensions: OnlinePbxExtension[] = [];
  let synchronized = true;
  try {
    extensions = await onlinePbxClient.listExtensions();
  } catch (error) {
    synchronized = false;
    logger.warn('Could not load existing OnlinePBX extensions', { error });
  }

  const extensionsByNumber = providerExtensionMap(extensions);
  const selectedManagers = managers.filter((manager) => (
    manager.enabled && Boolean(onlinePbxRoutingDestination(manager.extension))
  ));
  const selectedManagerIds = new Set(selectedManagers.map((manager) => manager.id));
  const primaryManagerId = company.primaryManagerId
    && selectedManagerIds.has(company.primaryManagerId)
    ? company.primaryManagerId
    : selectedManagers[0]?.id ?? null;
  const activePrimaryManagerId = getActivePrimaryManagerId(
    selectedManagers,
    primaryManagerId,
    extensionsByNumber,
  );

  return {
    ringDelaySeconds: ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
    primaryManagerId,
    activePrimaryManagerId,
    managers: managers.map((manager) => ({
      id: manager.id,
      fullName: manager.fullName,
    })),
    assignments: selectedManagers.map((manager) => {
      const extension = manager.extension!;
      const providerExtension = extensionsByNumber.get(extension);
      return {
        managerId: manager.id,
        fullName: manager.fullName,
        extension,
        isOnline: manager.isOnline,
        isProviderEnabled: Boolean(providerExtension?.enabled),
        isRegistered: Boolean(providerExtension?.registered),
        isTelephonyReady: Boolean(
          manager.isOnline
          && providerExtension?.enabled
          && providerExtension?.registered
        ),
        isPrimary: manager.id === primaryManagerId,
        isActivePrimary: manager.id === activePrimaryManagerId,
      };
    }),
    extensions,
    forwarding: {
      enabled: company.forwardingEnabled,
      phone: company.forwardingPhone,
    },
    synchronized,
  };
};

export const getOnlinePbxIncomingDelayMs = async (
  managerId: number,
  executor: Queryable = pool,
) => {
  const [managers, company] = await Promise.all([
    loadManagerRoutingRows(executor),
    loadCompanyRouting(executor),
  ]);
  const selected = managers.filter((manager) => (
    manager.enabled && Boolean(onlinePbxRoutingDestination(manager.extension))
  ));
  const online = selected.filter((manager) => manager.isOnline);
  const activePrimaryManagerId = online.find(
    (manager) => manager.id === company.primaryManagerId,
  )?.id ?? online[0]?.id ?? selected[0]?.id ?? null;
  return onlinePbxIncomingDelayMs(managerId, activePrimaryManagerId);
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

const syncOnlinePbxRoutingOnce = async () => {
  if (!onlinePbxClient.isConfigured()) {
    throw new OnlinePbxError('onlinePbxNotConfigured', 503);
  }

  const [providerExtensions, managers, company] = await Promise.all([
    onlinePbxClient.listExtensions(),
    loadManagerRoutingRows(pool),
    loadCompanyRouting(pool),
  ]);
  const extensionsByNumber = providerExtensionMap(providerExtensions);
  const candidates: OnlinePbxRoutingCandidate[] = managers.map((manager) => {
    const providerExtension = manager.extension
      ? extensionsByNumber.get(manager.extension)
      : undefined;
    return {
      id: manager.id,
      extension: manager.extension,
      enabled: manager.enabled,
      isOnline: manager.isOnline,
      isTelephonyReady: Boolean(
        providerExtension?.enabled && providerExtension?.registered
      ),
    };
  });

  const members = buildOnlinePbxRingMembers(candidates, {
    enabled: company.forwardingEnabled,
    phone: company.forwardingPhone,
  });
  const currentGroup = await onlinePbxClient.getGroup(ONLINE_PBX_RING_GROUP);
  const nextGroup: OnlinePbxGroup = {
    ...currentGroup,
    users: members,
    delay: members.length === 1 && members[0] === ONLINE_PBX_HANGUP_DESTINATION
      ? 1
      : ONLINE_PBX_GROUP_RING_DELAY_SECONDS,
    defaultDestination: null,
  };
  if (!groupRoutingMatches(currentGroup, nextGroup)) {
    await onlinePbxClient.updateGroup(nextGroup);
  }

  logger.info('OnlinePBX CRM manager routing synchronized', {
    onlineManagerIds: candidates
      .filter((candidate) => candidate.enabled && candidate.isOnline)
      .map((candidate) => candidate.id),
    extensions: members.filter((member) => member !== ONLINE_PBX_HANGUP_DESTINATION),
    forwardingEnabled: company.forwardingEnabled,
  });
  return members;
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
    logger.error('Failed to synchronize OnlinePBX CRM routing', { error });
  });
};
