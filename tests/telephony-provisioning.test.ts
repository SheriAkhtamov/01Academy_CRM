import { describe, expect, it, vi } from 'vitest';
import { ensureSalesTelephonyExtension } from '../server/services/telephony-provisioning';

describe('automatic OnlinePBX extension provisioning', () => {
  it('assigns the lowest free CRM-managed extension before creating another one', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM users')) return { rows: [{ extension: '100' }] };
      if (statement.includes('FROM telephony_managed_extensions')) {
        return { rows: [{ extension: '100' }, { extension: '109' }] };
      }
      return { rows: [] };
    });
    const provider = {
      listExtensions: vi.fn().mockResolvedValue([
        { extension: '100', name: 'Existing User', enabled: true, registered: false },
        { extension: '109', name: 'CRM109', enabled: true, registered: false },
      ]),
      createExtension: vi.fn(),
      updateExtension: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureSalesTelephonyExtension(
      { query } as any,
      { fullName: 'Новый Менеджер' },
      provider,
    )).resolves.toBe('109');

    expect(provider.createExtension).not.toHaveBeenCalled();
    expect(provider.updateExtension).toHaveBeenCalledWith({
      extension: '109',
      name: 'CRM Novyy Menedzher',
      enabled: true,
    });
  });

  it('creates and activates the next available extension when the reserve is empty', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM users')) return { rows: [{ extension: '100' }] };
      if (statement.includes('FROM telephony_managed_extensions')) return { rows: [{ extension: '100' }] };
      return { rows: [] };
    });
    const provider = {
      listExtensions: vi.fn().mockResolvedValue([
        { extension: '100', name: 'Existing User', enabled: true, registered: false },
      ]),
      createExtension: vi.fn()
        .mockRejectedValueOnce({ providerCode: 'INTERNAL' })
        .mockResolvedValueOnce(undefined),
      updateExtension: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureSalesTelephonyExtension(
      { query } as any,
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
      enabled: true,
    });
  });
});
