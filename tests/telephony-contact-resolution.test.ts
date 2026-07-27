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

import {
  ensureMissedCallTask,
  findContactByPhone,
  isMissedIncomingCall,
} from '../server/routes/telephony.routes';

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

describe('missed incoming call detection', () => {
  it.each(['missed', 'failed', 'declined'])(
    'creates a callback task for an unanswered incoming call with status %s',
    (status) => {
      expect(isMissedIncomingCall({ direction: 'incoming', status, talkSeconds: 0 })).toBe(true);
    },
  );

  it('does not create a callback task for answered, outgoing, or active calls', () => {
    expect(isMissedIncomingCall({
      direction: 'incoming',
      status: 'ended',
      talkSeconds: 42,
    })).toBe(false);
    expect(isMissedIncomingCall({
      direction: 'incoming',
      status: 'failed',
      talkSeconds: 12,
    })).toBe(false);
    expect(isMissedIncomingCall({
      direction: 'outgoing',
      status: 'failed',
      talkSeconds: 0,
    })).toBe(false);
    expect(isMissedIncomingCall({
      direction: 'incoming',
      status: 'ringing',
      talkSeconds: 0,
    })).toBe(false);
  });

  it('persists one lead-linked urgent task and its activity record', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 91, boardId: 4, creatorId: 7 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ensureMissedCallTask(
      { query } as never,
      {
        id: 44,
        direction: 'incoming',
        status: 'missed',
        phone: '+998901234567',
        leadId: 23,
        contactName: 'Азиз',
        talkSeconds: 0,
      },
    )).resolves.toEqual({ id: 91, boardId: 4 });

    const [taskSql, taskParams] = query.mock.calls[0];
    expect(taskSql).toContain('lead_id, telephony_call_id, due_at');
    expect(taskSql).toContain('ON CONFLICT ("telephony_call_id")');
    expect(taskParams).toEqual([
      44,
      23,
      'Перезвонить: пропущенный звонок',
      'Пропущен входящий звонок от Азиз (+998901234567). Связаться с контактом как можно скорее.',
    ]);

    const [activitySql, activityParams] = query.mock.calls[1];
    expect(activitySql).toContain('INSERT INTO board_task_activity');
    expect(activityParams[0]).toBe(91);
    expect(JSON.parse(activityParams[2])).toEqual({
      source: 'missed_call',
      telephonyCallId: 44,
    });
  });

  it('does nothing for a call that was answered', async () => {
    const query = vi.fn();

    await expect(ensureMissedCallTask(
      { query } as never,
      {
        id: 45,
        direction: 'incoming',
        status: 'ended',
        phone: '+998901234567',
        talkSeconds: 18,
      },
    )).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
