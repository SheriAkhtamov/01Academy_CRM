import { describe, expect, it, vi } from 'vitest';
import { syncLeadSourceChannel, upsertLeadChannel } from '../server/services/lead-channels';

describe('lead channel persistence', () => {
  it('reuses the provider-backed Instagram identity instead of creating a messenger duplicate', async () => {
    const providerChannel = {
      id: 7,
      lead_id: 42,
      channel: 'instagram',
      provider_account_id: 'business-account',
      external_id: 'participant-id',
      handle: 'zero.one',
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ channel: 'instagram' }] })
      .mockResolvedValueOnce({ rows: [providerChannel] });

    const result = await syncLeadSourceChannel({ query } as any, {
      leadId: 42,
      sourceId: 3,
      messenger: '@Zero.One',
    });

    expect(result).toEqual(providerChannel);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("provider_account_id <> ''");
    expect(query.mock.calls[1][1]).toEqual([42, null, 'Zero.One']);
  });

  it('removes a matching legacy row after saving an authoritative Instagram identity', async () => {
    const savedChannel = { id: 12, channel: 'instagram' };
    const mergedChannel = { ...savedChannel, metadata: { conversationId: 99 } };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [savedChannel] })
      .mockResolvedValueOnce({ rows: [mergedChannel] });

    const result = await upsertLeadChannel({ query } as any, {
      leadId: 42,
      channel: 'instagram',
      providerAccountId: 'business-account',
      externalId: 'participant-id',
      handle: '@Zero.One',
      metadata: { conversationId: 99 },
    });

    expect(result).toEqual(mergedChannel);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('DELETE FROM academy_lead_channels');
    expect(query.mock.calls[1][0]).toContain('legacy_channel.metadata || provider_channel.metadata');
    expect(query.mock.calls[1][1]).toEqual([42, 12, 'participant-id', 'Zero.One']);
  });
});
