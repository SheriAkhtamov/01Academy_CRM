import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { canAdvanceLeadFromDemo, demoAttendanceStage, isDemoPipelineStage } from '../shared/demo-pipeline';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), updateRow: vi.fn(), createAudit: vi.fn(),
  createStageHistory: vi.fn(), handleLeadStatusEffects: vi.fn(),
}));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
import { lockDemoParticipantLeads, syncDemoLeadStatuses } from '../server/modules/academy/demo-lead-status';

const actor = { id: 7, module: 'sales' };
const lead = { id: 12, statusCode: 'demo_invited', isArchived: false, demoAttended: false };

describe('demo attendance to parent lead stage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ code: 'demo_attended' }]);
    mocks.updateRow.mockImplementation(async (_table, id, values) => ({ id, ...values }));
  });

  it.each([
    [['attended'], 'demo_attended'],
    [['no_show'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'attended'], 'demo_attended'],
    [['attended', 'confirmed'], 'demo_attended'],
    [['no_show', 'no_show'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'invited'], null],
    [['no_show', 'confirmed'], null],
    [['no_show', 'cancelled'], 'ne_prishli_na_vstrechu'],
    [['invited'], null],
    [['cancelled'], null],
    [[], null],
  ])('aggregates sibling marks %j into %s', (statuses, expected) => {
    expect(demoAttendanceStage(statuses as string[])).toBe(expected);
  });

  it.each(['offer', 'thinking', 'enrolled', 'paid', 'not_now'])('does not regress %s', async (statusCode) => {
    expect(canAdvanceLeadFromDemo({ statusCode })).toBe(false);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode }]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('does not change or restore archived parents', async () => {
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, isArchived: true }]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it.each([
    ['attended', 'demo_attended', true],
    ['no_show', 'ne_prishli_na_vstrechu', false],
  ])('updates the parent and its history for %s', async (status, statusCode, demoAttended) => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: [status] }]);
    await syncDemoLeadStatuses(actor, 3, [lead]);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 12, { statusCode, demoAttended });
    expect(mocks.createStageHistory).toHaveBeenCalledWith(12, 'demo_invited', statusCode, 7, expect.stringContaining('#3'));
    expect(mocks.handleLeadStatusEffects).toHaveBeenCalledOnce();
    expect(mocks.createAudit).toHaveBeenCalledOnce();
  });

  it('is idempotent when the same marks are saved twice', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended', demoAttended: true }]);
    expect(mocks.updateRow).not.toHaveBeenCalled();
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
  });

  it('updates stale analytics flags without duplicate stage history', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended' }]);
    expect(mocks.updateRow).toHaveBeenCalledOnce();
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
    expect(mocks.handleLeadStatusEffects).not.toHaveBeenCalled();
  });

  it('corrects attendance from present to absent', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['no_show'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended', demoAttended: true }]);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 12, {
      statusCode: 'ne_prishli_na_vstrechu', demoAttended: false,
    });
  });

  it('does not mark the parent absent while a sibling is still pending', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['no_show', 'invited'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead]);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('keeps recorded no-shows when the lesson was not conducted because nobody came', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, status: 'not_conducted', statuses: ['no_show'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead]);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 12, {
      statusCode: 'ne_prishli_na_vstrechu', demoAttended: false,
    });
    expect(demoAttendanceStage(['attended'], 'not_conducted')).toBeNull();
    expect(demoAttendanceStage(['no_show'], 'cancelled')).toBeNull();
  });

  it.each([{ demos: [] }, { demos: [{ id: 3, statuses: ['confirmed'] }] }])('clears an outcome after cancellation/reset: $demos', async ({ demos }) => {
    mocks.query.mockResolvedValueOnce(demos);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended', demoAttended: true }]);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 12, {
      statusCode: 'demo_invited', demoAttended: false,
    });
  });

  it('keeps a newer demo result when an older demo is edited', async () => {
    mocks.query.mockResolvedValueOnce([
      { id: 9, statuses: ['attended'] }, { id: 3, statuses: ['no_show'] },
    ]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended', demoAttended: true }], true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY demo.scheduled_at DESC, demo.id DESC'), [12, 3, true]);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('fails before updating the lead if the stage is missing', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['attended'] }]).mockResolvedValueOnce([]);
    await expect(syncDemoLeadStatuses(actor, 3, [lead])).rejects.toMatchObject({ message: 'invalidLeadStatus', statusCode: 409 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
  });

  it('locks distinct parent leads through student links in a stable order', async () => {
    await lockDemoParticipantLeads(3, [5, 6]);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('SELECT student.lead_id FROM academy_students');
    expect(sql).toContain('ORDER BY lead.id FOR UPDATE OF lead');
    expect(params).toEqual([3, [5, 6]]);
  });

  it('does not treat a new pending booking as a reset of the previous result', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 2, status: 'completed', statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'demo_attended', demoAttended: true }]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('OR (demo.id = $2 AND $3::boolean)'), [12, 3, false]);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('protects stable codes independently of editable names/system flags', () => {
    expect(isDemoPipelineStage('demo_attended')).toBe(true);
    expect(isDemoPipelineStage('ne_prishli_na_vstrechu')).toBe(true);
    expect(isDemoPipelineStage('Встреча проведена')).toBe(false);
    expect(isDemoPipelineStage('custom')).toBe(false);
  });

  it('migrates the existing stages without changing lead history or stage names', () => {
    const sql = readFileSync(new URL('../migrations/0099_protect_demo_pipeline_statuses.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ON CONFLICT (code) DO UPDATE');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain("IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;");
    expect(sql).not.toMatch(/UPDATE\s+academy_leads/);
    expect(sql).not.toContain('SET name');
  });
});
