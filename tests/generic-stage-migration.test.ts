import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../migrations/0128_generic_funnel_stages_and_qualification.sql', import.meta.url), 'utf8');
describe('generic stage migration invariants', () => {
  it('removes each legacy coded-stage protection before changing stage ownership', () => {
    for (const trigger of ['academy_protect_demo_pipeline_statuses', 'academy_protect_sales_workflow_lead',
      'academy_protect_scoped_sales_stage', 'academy_auto_distribute_lead', 'academy_kpi_lead_capture']) {
      expect(sql.indexOf(`DROP TRIGGER IF EXISTS ${trigger}`)).toBeLessThan(sql.indexOf('CREATE TEMP TABLE academy_stage_scope_conversion'));
    }
    expect(sql).toContain('DROP FUNCTION IF EXISTS academy_transition_demo_lead');
    expect(sql).toContain('DROP FUNCTION IF EXISTS academy_sales_stage_role');
  });
  it('scopes every shared label while retaining the current lead and its historical name snapshots', () => {
    expect(sql).toContain('UPDATE academy_leads lead SET status_code = map.new_code');
    expect(sql).toContain('map.funnel_id = lead.funnel_id');
    expect(sql).toContain('from_status_name = (SELECT name FROM academy_lead_statuses');
    expect(sql).toContain('to_status_name = (SELECT name FROM academy_lead_statuses');
    expect(sql).toContain('ALTER TABLE academy_lead_statuses ALTER COLUMN funnel_id SET NOT NULL');
  });
  it('uses the explicit initial stage for intake and has no employee role gate in distribution', () => {
    const distribution = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION academy_next_auto_lead_manager'));
    expect(distribution).not.toContain('academy_kpi_employee_role');
    expect(distribution).not.toContain('workflow_role');
    expect(distribution).toContain('assignment.funnel_id = p_funnel_id');
    expect(distribution).toContain('auto_lead_distribution_cursor % manager_count');
    expect(sql).toContain('initial_stage_code = NEW.status_code');
  });
  it('derives cold/reactivation only from archival and never qualification from profile completeness', () => {
    const capture = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION academy_kpi_capture_lead'), sql.indexOf('CREATE TRIGGER academy_kpi_lead_capture'));
    expect(capture).toContain('is_cold := NEW.is_archived');
    expect(capture).toContain('was_cold := OLD.is_archived');
    expect(capture).not.toContain('status_code');
    expect(capture).not.toContain('qualified_at');
  });
  it('repairs legacy cold labels and proven clone identities without changing custom activation or lead state', () => {
    const repair = readFileSync(new URL('../migrations/0131_restore_legacy_cold_stage_visibility.sql', import.meta.url), 'utf8');
    expect(repair).toContain("WHERE code = 'not_now'");
    expect(repair).toContain("'^not_now_f' || candidate.funnel_id || '_s' || legacy.id");
    expect(repair).toContain('candidate.created_at > legacy.created_at');
    expect(repair).toContain('intake.code = funnel.initial_stage_code');
    expect(repair).toContain("source.code IN ('new_request', 'demo_attended')");
    expect(repair).toContain('candidate.created_at IN (SELECT created_at FROM conversion_times)');
    expect(repair).toContain('candidate.name = legacy.name AND candidate.color = legacy.color');
    expect(repair).toContain('candidate.is_active = legacy.is_active');
    expect(repair).toContain('AND stage.is_pipeline = false');
    expect(repair).not.toMatch(/SET\s+(?:is_active|is_archived|name)\b/i);
    expect(repair).not.toContain('UPDATE academy_leads');
  });
});
