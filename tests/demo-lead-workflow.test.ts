import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { canAdvanceLeadFromDemo, demoAttendanceStage, isDemoPipelineStage } from '../shared/demo-pipeline';

const mocks = vi.hoisted(() => ({ query: vi.fn(), createAudit: vi.fn(), transitionDemoLead: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/demo-lead-transition', () => mocks);
import { lockDemoParticipantLeads, syncDemoLeadStatuses } from '../server/modules/academy/demo-lead-status';

const actor = { id: 7, module: 'sales' };
const lead = { id: 12, funnelId: 1, managerId: 18, statusCode: 'demo_invited', isArchived: false, demoAttended: false };

describe('demo attendance drives the lead workflow without counting sibling attendance', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.transitionDemoLead.mockImplementation(async (_source, previous, statusCode, demoAttended) => ({
      ...previous, statusCode, demoAttended, funnelId: statusCode === 'demo_attended' ? 3 : 1,
    }));
  });

  it.each([
    [['attended'], 'demo_attended'],
    [['no_show'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'attended'], 'demo_attended'],
    [['attended', 'no_show'], 'demo_attended'],
    [['attended', 'confirmed'], 'demo_attended'],
    [['no_show', 'no_show'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'invited'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'confirmed'], 'ne_prishli_na_vstrechu'],
    [['no_show', 'cancelled'], 'ne_prishli_na_vstrechu'],
    [['invited'], null], [['cancelled'], null], [[], null],
  ])('routes sibling marks %j into %s with attendance taking priority', (statuses, expected) => {
    expect(demoAttendanceStage(statuses as string[])).toBe(expected);
  });

  it.each(['offer', 'thinking', 'enrolled', 'paid', 'not_now'])('does not regress %s', async (statusCode) => {
    expect(canAdvanceLeadFromDemo({ statusCode })).toBe(false);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode }]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it('does not change or restore archived parents', async () => {
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, isArchived: true }]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it.each([
    [['attended', 'invited'], 'demo_attended', true],
    [['no_show', 'invited'], 'ne_prishli_na_vstrechu', false],
    [['attended', 'no_show'], 'demo_attended', true],
  ])('transitions on a single mark in %j while retaining the original owner', async (statuses, statusCode, demoAttended) => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses }]);
    await syncDemoLeadStatuses(actor, 3, [lead], true);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, lead, statusCode, demoAttended, 3, expect.stringContaining('#3'));
    expect(mocks.createAudit).toHaveBeenCalledOnce();
  });

  it('does not replace a sales owner with the teacher recording attendance', async () => {
    const teacher = { id: 4, module: 'teacher' };
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['attended', 'invited'] }]);
    await syncDemoLeadStatuses(teacher, 3, [lead], true);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(teacher,
      expect.objectContaining({ managerId: 18 }), 'demo_attended', true, 3, expect.any(String));
  });

  it('does not duplicate audit when the same marks are saved twice', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, funnelId: 3, statusCode: 'demo_attended', demoAttended: true }]);
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('returns to the no-show stage when the only attending student is corrected to absent', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, statuses: ['no_show', 'invited'] }]);
    const previous = { ...lead, funnelId: 3, statusCode: 'demo_attended', demoAttended: true };
    await syncDemoLeadStatuses(actor, 3, [previous], true);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, previous, 'ne_prishli_na_vstrechu', false, 3, expect.any(String));
  });

  it('keeps no-shows when the lesson was not conducted because nobody came', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, status: 'not_conducted', statuses: ['no_show', 'invited'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead]);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, lead, 'ne_prishli_na_vstrechu', false, 3, expect.any(String));
    expect(demoAttendanceStage(['attended'], 'not_conducted')).toBeNull();
    expect(demoAttendanceStage(['no_show'], 'cancelled')).toBeNull();
  });

  it.each([{ demos: [] }, { demos: [{ id: 3, statuses: ['confirmed'] }] }])('resets automatic outcomes after cancellation/reset: $demos', async ({ demos }) => {
    mocks.query.mockResolvedValueOnce(demos);
    const previous = { ...lead, funnelId: 3, statusCode: 'demo_attended', demoAttended: true };
    await syncDemoLeadStatuses(actor, 3, [previous], true);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, previous, 'demo_invited', false, 3, expect.any(String));
  });

  it('keeps a newer result when an older demo is edited', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 9, statuses: ['attended'] }, { id: 3, statuses: ['no_show'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead], true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY demo.scheduled_at DESC, demo.id DESC'), [12, 3, true]);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, lead, 'demo_attended', true, 9, expect.any(String));
  });

  it('does not let a new pending booking erase an earlier result', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 2, status: 'completed', statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('OR (demo.id = $2 AND $3::boolean)'), [12, 3, false]);
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(actor, lead, 'demo_attended', true, 2, expect.any(String));
  });

  it('leaves an unmarked lead on its current stage', async () => {
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, statusCode: 'qualified' }]);
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it('locks parent leads before participants in stable order', async () => {
    await lockDemoParticipantLeads(3, [5, 6]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY lead.id FOR UPDATE OF lead'), [3, [5, 6]]);
  });

  it('keeps stable stage protections but no longer requires every sibling to be absent', () => {
    expect(isDemoPipelineStage('demo_attended')).toBe(true);
    expect(isDemoPipelineStage('ne_prishli_na_vstrechu')).toBe(true);
    expect(isDemoPipelineStage('custom')).toBe(false);
    const sql = readFileSync(new URL('../migrations/0115_demo_attendance_workflow.sql', import.meta.url), 'utf8');
    expect(sql).toContain('academy_transition_demo_lead');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).not.toMatch(/SET\s+manager_id\s*=/i);
    expect(sql).toContain('ON CONFLICT (participant_id) DO NOTHING');
  });
});
