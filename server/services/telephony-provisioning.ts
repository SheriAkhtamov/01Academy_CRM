import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ONLINE_PBX_EXTENSION_MAX,
  ONLINE_PBX_EXTENSION_MIN,
  isOnlinePbxExtension,
} from '@shared/telephony';
import { onlinePbxClient, OnlinePbxError, type OnlinePbxExtension } from './onlinepbx';

type Queryable = Pick<PoolClient, 'query'>;
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

const findNextExtension = (unavailable: Set<string>) => {
  for (let number = ONLINE_PBX_EXTENSION_MIN; number <= ONLINE_PBX_EXTENSION_MAX; number += 1) {
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
  if (isOnlinePbxExtension(currentExtension)) return currentExtension;

  await client.query('SELECT pg_advisory_xact_lock($1)', [EXTENSION_PROVISIONING_LOCK]);

  const [assignedResult, managedResult, providerExtensions] = await Promise.all([
    client.query<{ extension: string }>(
      `SELECT online_pbx_extension AS extension
       FROM users
       WHERE online_pbx_extension IS NOT NULL
         AND BTRIM(online_pbx_extension) <> ''`,
    ),
    client.query<{ extension: string }>(
      `SELECT extension
       FROM telephony_managed_extensions
       WHERE provider = 'onlinepbx'`,
    ),
    provider.listExtensions(),
  ]);

  const assigned = new Set(assignedResult.rows.map((row) => String(row.extension).trim()));
  const managed = new Set(managedResult.rows.map((row) => String(row.extension).trim()));
  const providerByExtension = new Map(
    providerExtensions
      .filter((extension) => isOnlinePbxExtension(extension.extension))
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
      enabled: true,
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

  const password = crypto.randomBytes(8).toString('hex');
  const name = onlinePbxEmployeeName(input.fullName, extension);
  await createProviderExtension(provider, { extension, password, name });
  await provider.updateExtension({ extension, name, enabled: true });
  await client.query(
    `INSERT INTO telephony_managed_extensions (extension, provider)
     VALUES ($1, 'onlinepbx')
     ON CONFLICT (extension) DO UPDATE SET updated_at = NOW()`,
    [extension],
  );
  return extension;
};
