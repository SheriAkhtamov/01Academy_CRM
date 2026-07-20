import type { PoolClient } from 'pg';
import {
  buildLeadChannelProfileUrl,
  normalizeLeadChannelHandle,
} from '@shared/lead-channels';

type Queryable = Pick<PoolClient, 'query'>;

export interface LeadChannelInput {
  leadId: number;
  channel: string;
  providerAccountId?: string | null;
  externalId?: string | null;
  handle?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
}

const nullable = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || null;
};

export const upsertLeadChannel = async (client: Queryable, input: LeadChannelInput) => {
  const channel = input.channel.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(channel)) return null;

  const providerAccountId = String(input.providerAccountId ?? '').trim();
  const externalId = nullable(input.externalId);
  const handle = normalizeLeadChannelHandle(input.handle);
  const displayName = nullable(input.displayName);
  const profileUrl = input.profileUrl
    ?? buildLeadChannelProfileUrl(channel, handle, input.phone);
  if (!externalId && !handle && !profileUrl) return null;

  if (externalId) {
    const result = await client.query(
      `INSERT INTO academy_lead_channels (
         lead_id, channel, provider_account_id, external_id, handle,
         display_name, profile_url, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (channel, provider_account_id, external_id)
         WHERE external_id IS NOT NULL AND BTRIM(external_id) <> ''
       DO UPDATE SET
         lead_id = EXCLUDED.lead_id,
         handle = COALESCE(EXCLUDED.handle, academy_lead_channels.handle),
         display_name = COALESCE(EXCLUDED.display_name, academy_lead_channels.display_name),
         profile_url = COALESCE(EXCLUDED.profile_url, academy_lead_channels.profile_url),
         metadata = academy_lead_channels.metadata || EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING *`,
      [
        input.leadId,
        channel,
        providerAccountId,
        externalId,
        handle,
        displayName,
        profileUrl,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const channelRow = result.rows[0] ?? null;
    if (channelRow && channel === 'instagram' && providerAccountId) {
      const cleanup = await client.query(
        `WITH legacy_channel AS (
           DELETE FROM academy_lead_channels
           WHERE lead_id = $1
             AND channel = 'instagram'
             AND id <> $2
             AND provider_account_id = ''
             AND (
               ($3::text IS NOT NULL AND external_id = $3)
               OR (
                 $4::text IS NOT NULL
                 AND handle IS NOT NULL
                 AND LOWER(REGEXP_REPLACE(handle, '^@+', '')) = LOWER($4)
               )
             )
           RETURNING display_name, profile_url, metadata
         )
         UPDATE academy_lead_channels provider_channel
         SET display_name = COALESCE(provider_channel.display_name, legacy_channel.display_name),
             profile_url = COALESCE(provider_channel.profile_url, legacy_channel.profile_url),
             metadata = legacy_channel.metadata || provider_channel.metadata,
             updated_at = NOW()
         FROM legacy_channel
         WHERE provider_channel.id = $2
         RETURNING provider_channel.*`,
        [input.leadId, channelRow.id, externalId, handle],
      );
      return cleanup.rows[0] ?? channelRow;
    }
    return channelRow;
  }

  const result = await client.query(
    `INSERT INTO academy_lead_channels (
       lead_id, channel, provider_account_id, external_id, handle,
       display_name, profile_url, metadata
     )
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7::jsonb)
     ON CONFLICT (lead_id, channel, provider_account_id, LOWER(handle))
       WHERE handle IS NOT NULL AND BTRIM(handle) <> ''
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, academy_lead_channels.display_name),
       profile_url = COALESCE(EXCLUDED.profile_url, academy_lead_channels.profile_url),
       metadata = academy_lead_channels.metadata || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [
      input.leadId,
      channel,
      providerAccountId,
      handle,
      displayName,
      profileUrl,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
};

export const syncLeadSourceChannel = async (
  client: Queryable,
  input: {
    leadId: number;
    sourceId: number | null | undefined;
    messenger?: string | null;
    phone?: string | null;
  },
) => {
  if (!input.sourceId) return null;
  const source = await client.query<{ channel: string | null }>(
    `SELECT channel FROM academy_lead_sources WHERE id = $1`,
    [input.sourceId],
  );
  const channel = String(source.rows[0]?.channel ?? '').trim().toLowerCase();
  if (!['instagram', 'telegram', 'whatsapp'].includes(channel)) return null;

  const messenger = nullable(input.messenger);
  const externalId = channel === 'instagram' && messenger?.toLowerCase().startsWith('instagram:')
    ? messenger.slice('instagram:'.length)
    : channel === 'whatsapp'
      ? String(input.phone ?? '').replace(/\D/g, '') || null
      : null;
  const handle = messenger && !messenger.toLowerCase().startsWith('instagram:')
    ? normalizeLeadChannelHandle(messenger)
    : null;

  if (channel === 'instagram' && (externalId || handle)) {
    const existing = await client.query(
      `SELECT *
       FROM academy_lead_channels
       WHERE lead_id = $1
         AND channel = 'instagram'
         AND provider_account_id <> ''
         AND (
           ($2::text IS NOT NULL AND external_id = $2)
           OR (
             $3::text IS NOT NULL
             AND handle IS NOT NULL
             AND LOWER(REGEXP_REPLACE(handle, '^@+', '')) = LOWER(REGEXP_REPLACE($3, '^@+', ''))
           )
         )
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [input.leadId, externalId, handle],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  return upsertLeadChannel(client, {
    leadId: input.leadId,
    channel,
    externalId,
    handle,
    phone: input.phone,
    metadata: { sourceId: input.sourceId },
  });
};
