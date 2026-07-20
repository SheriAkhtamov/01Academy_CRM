import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../server/config', () => ({
  appConfig: { integrations: { onlinePbx: {} } },
  isDevelopmentEnvironment: false,
  isProductionEnvironment: false,
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: vi.fn(),
  },
}));

vi.mock('../server/services/onlinepbx', () => ({
  normalizeOnlinePbxPhone: (value: unknown) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? `+${digits}` : null;
  },
  onlinePbxClient: {},
  OnlinePbxError: class OnlinePbxError extends Error {},
}));

import { findContactByPhone } from '../server/routes/telephony.routes';

describe('telephony contact resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches an archived lead instead of creating a duplicate', async () => {
    const archivedLead = {
      type: 'lead',
      id: 23,
      leadId: 23,
      name: 'Архивный лид',
      secondaryName: null,
      phone: '+998901260005',
    };
    mocks.poolQuery.mockResolvedValue({ rows: [archivedLead] });

    await expect(findContactByPhone('+998 90 126 00 05')).resolves.toEqual(archivedLead);

    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(params).toEqual(['998901260005']);
    expect(sql).toContain('FROM academy_lead_phones phone');
    expect(sql).toContain('FROM academy_leads lead');
    expect(sql).toContain('COALESCE(lead.is_archived, false) AS is_archived');
    expect(sql).toContain('ORDER BY priority, is_archived');
    expect(sql).not.toContain("COALESCE(lead.is_archived, false) = false");
  });

  it('falls back to the lead card phone when the phone index is missing', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });

    await findContactByPhone('+998901260005');

    const sql = String(mocks.poolQuery.mock.calls[0][0]);
    expect(sql).toContain("COALESCE(lead.phone, '') ~ '^[+()0-9[:space:].-]+$'");
    expect(sql).toContain("THEN '998' || regexp_replace(lead.phone");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('indexed_phone.lead_id = lead.id');
  });
});
