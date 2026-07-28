import { describe, expect, it, vi } from 'vitest';
import { ensureSalesTelephonyExtension } from '../server/services/telephony-provisioning';

describe('automatic OnlinePBX extension provisioning', () => {
  it('never reuses legacy shared extension 100 and prefers a free CRM-managed extension', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM users')) return { rows: [] };
      if (statement.includes('FROM telephony_managed_extensions')) {
        return { rows: [{ extension: '109' }] };
      }
      return { rows: [] };
    });
    const provider = {
      listExtensions: vi.fn().mockResolvedValue([
        { extension: '100', name: '01Academy', enabled: true, registered: true },
        { extension: '109', name: 'CRM109', enabled: true, registered: false },
      ]),
      createExtension: vi.fn(),
      updateExtension: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureSalesTelephonyExtension(
      { query } as never,
      { fullName: 'Новый Менеджер', currentExtension: '100' },
      provider,
    )).resolves.toBe('109');

    expect(provider.createExtension).not.toHaveBeenCalled();
    expect(provider.updateExtension).toHaveBeenCalledWith({
      extension: '109',
      name: 'CRM Novyy Menedzher',
    });
  });

  it('creates and activates extension 101 when only the shared account exists', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM users')) return { rows: [] };
      if (statement.includes('FROM telephony_managed_extensions')) return { rows: [] };
      return { rows: [] };
    });
    const provider = {
      listExtensions: vi.fn().mockResolvedValue([
        { extension: '100', name: '01Academy', enabled: true, registered: true },
      ]),
      createExtension: vi.fn()
        .mockRejectedValueOnce({ providerCode: 'INTERNAL' })
        .mockResolvedValueOnce(undefined),
      updateExtension: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureSalesTelephonyExtension(
      { query } as never,
      { fullName: 'Sales User' },
      provider,
    )).resolves.toBe('101');

    expect(provider.createExtension).toHaveBeenCalledWith(expect.objectContaining({
      extension: '101',
      name: 'CRM Sales User',
    }));
    expect(provider.createExtension).toHaveBeenCalledTimes(2);
    expect(provider.updateExtension).toHaveBeenCalledWith({
      extension: '101',
      name: 'CRM Sales User',
    });
  });
});
