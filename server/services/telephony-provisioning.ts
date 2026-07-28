import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ONLINE_PBX_LEGACY_SHARED_EXTENSION,
  ONLINE_PBX_UNIQUE_EXTENSION_MIN,
  ONLINE_PBX_EXTENSION_MAX,
  isOnlinePbxExtension,
} from '@shared/telephony';
import { pool } from '../db';
import { onlinePbxClient, OnlinePbxError, type OnlinePbxExtension } from './onlinepbx';

type Queryable = Pick<Pool | PoolClient, 'query'>;
type ProvisioningProvider = Pick<
  typeof onlinePbxClient,
  'listExtensions' | 'createExtension' | 'updateExtension'
>;

const EXTENSION_PROVISIONING_LOCK = 10_100_002;

const translitMap: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

const onlinePbxEmployeeName = (fullName: string, extension: string) => {
  const latinName = fullName
    .trim()
    .toLowerCase()
    .split('')
    .map((character) => translitMap[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, 48);
  return `CRM ${latinName || `User ${extension}`}`;
};

const extensionNumber = (extension: string) => Number(extension);

const isDedicatedExtension = (extension: string | null | undefined) => (
  isOnlinePbxExtension(extension)
  && extension !== ONLINE_PBX_LEGACY_SHARED_EXTENSION
);

const findNextExtension = (unavailable: Set<string>) => {
  for (
    let number = ONLINE_PBX_UNIQUE_EXTENSION_MIN;
    number <= ONLINE_PBX_EXTENSION_MAX;
    number += 1
  ) {
    const extension = String(number);
    if (!unavailable.has(extension)) return extension;
  }
  return null;
};

const isRecoverableCrmExtension = (extension: OnlinePbxExtension) =>
  /^CRM(?:\s|\d)/i.test(extension.name ?? '');

const createProviderExtension = async (
  provider: ProvisioningProvider,
  input: { extension: string; password: string; name: string },
) => {
  try {
    await provider.createExtension(input);
  } catch (error) {
    const providerCode = error instanceof OnlinePbxError
      ? error.providerCode
      : (error as { providerCode?: string } | null)?.providerCode;
    if (providerCode !== 'INTERNAL') throw error;
    await provider.createExtension(input);
  }
};

export const ensureSalesTelephonyExtension = async (
  client: Queryable,
  input: { fullName: string; currentExtension?: string | null },
  provider: ProvisioningProvider = onlinePbxClient,
) => {
  const currentExtension = String(input.currentExtension ?? '').trim();
  if (isDedicatedExtension(currentExtension)) return currentExtension;

  await client.query('SELECT pg_advisory_xact_lock($1)', [EXTENSION_PROVISIONING_LOCK]);

  const [assignedResult, managedResult, providerExtensions] = await Promise.all([
    client.query<{ extension: string }>(
      `SELECT online_pbx_extension AS extension
       FROM users
       WHERE online_pbx_extension IS NOT NULL
         AND BTRIM(online_pbx_extension) <> ''
         AND online_pbx_extension <> $1`,
      [ONLINE_PBX_LEGACY_SHARED_EXTENSION],
    ),
    client.query<{ extension: string }>(
      `SELECT extension
       FROM telephony_managed_extensions
       WHERE provider = 'onlinepbx'
         AND extension <> $1`,
      [ONLINE_PBX_LEGACY_SHARED_EXTENSION],
    ),
    provider.listExtensions(),
  ]);

  const assigned = new Set(assignedResult.rows.map((row) => String(row.extension).trim()));
  const managed = new Set(managedResult.rows.map((row) => String(row.extension).trim()));
  const providerByExtension = new Map(
    providerExtensions
      .filter((extension) => isDedicatedExtension(extension.extension))
      .map((extension) => [extension.extension, extension]),
  );

  const reserve = [...providerByExtension.values()]
    .filter((extension) => (
      !assigned.has(extension.extension)
      && (managed.has(extension.extension) || isRecoverableCrmExtension(extension))
    ))
    .sort((left, right) => extensionNumber(left.extension) - extensionNumber(right.extension))[0];

  if (reserve) {
    await provider.updateExtension({
      extension: reserve.extension,
      name: onlinePbxEmployeeName(input.fullName, reserve.extension),
    });
    await client.query(
      `INSERT INTO telephony_managed_extensions (extension, provider, updated_at)
       VALUES ($1, 'onlinepbx', NOW())
       ON CONFLICT (extension) DO UPDATE SET updated_at = NOW()`,
      [reserve.extension],
    );
    return reserve.extension;
  }

  const unavailable = new Set([...assigned, ...providerByExtension.keys()]);
  const extension = findNextExtension(unavailable);
  if (!extension) {
    throw Object.assign(new Error('onlinePbxExtensionPoolExhausted'), { statusCode: 409 });
  }

  const password = crypto.randomBytes(16).toString('base64url');
  const name = onlinePbxEmployeeName(input.fullName, extension);
  await createProviderExtension(provider, { extension, password, name });
  await provider.updateExtension({ extension, name });
  await client.query(
    `INSERT INTO telephony_managed_extensions (extension, provider)
     VALUES ($1, 'onlinepbx')
     ON CONFLICT (extension) DO UPDATE SET updated_at = NOW()`,
    [extension],
  );
  return extension;
};

export const provisionActiveSalesTelephonyExtensions = async (
  databasePool: Pick<Pool, 'query' | 'connect'> = pool,
) => {
  const managers = await databasePool.query<{
    id: number;
    fullName: string;
    extension: string | null;
  }>(
    `SELECT manager.id,
            manager.full_name AS "fullName",
            manager.online_pbx_extension AS extension
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
     ORDER BY manager.id`,
  );

  const provisioned = new Map<number, string>();
  for (const manager of managers.rows) {
    if (isDedicatedExtension(manager.extension)) {
      provisioned.set(manager.id, manager.extension!);
      continue;
    }

    const client = await databasePool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        fullName: string;
        extension: string | null;
      }>(
        `SELECT full_name AS "fullName",
                online_pbx_extension AS extension
         FROM users
         WHERE id = $1
           AND is_active = true
         FOR UPDATE`,
        [manager.id],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        continue;
      }
      const extension = await ensureSalesTelephonyExtension(client, {
        fullName: current.fullName,
        currentExtension: current.extension,
      });
      await client.query(
        `UPDATE users
         SET online_pbx_extension = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [manager.id, extension],
      );
      await client.query('COMMIT');
      provisioned.set(manager.id, extension);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return provisioned;
};
