import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { updateLeadDistributionRequestSchema } from '../shared/contracts/lead-distribution';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorViewLead } from '../server/modules/leads/domain/access-policy';
import { unassignedLeadVisibleToSalesSql } from '../server/services/lead-distribution-visibility';

const migration = readFileSync(
  new URL('../migrations/0113_auto_lead_distribution.sql', import.meta.url),
  'utf8',
);
const eligibilityMigration = readFileSync(
  new URL('../migrations/0114_require_kpi_for_auto_lead_distribution.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
));
const route = readFileSync(
  new URL('../server/modules/academy/lead-distribution.router.ts', import.meta.url),
  'utf8',
);
const settingsPage = readFileSync(
  new URL('../client/src/pages/academy-settings.tsx', import.meta.url),
  'utf8',
);
const panel = readFileSync(
  new URL('../client/src/features/lead-distribution/LeadDistributionPanel.tsx', import.meta.url),
  'utf8',
);

const salesActor = (autoLeadDistributionEnabled: boolean): ActorContext => ({
  ...actorContextFrom({ id: 7, module: 'sales' }),
  salesWorkflow: {
    role: 'hunter',
    hunterFunnelId: 1,
    closerFunnelId: 2,
    defaultFunnelId: 1,
    assignedFunnelIds: [1],
    autoLeadDistributionEnabled,
  },
});

describe('automatic lead distribution contract and visibility', () => {
  it('accepts only an explicit boolean toggle', () => {
    expect(updateLeadDistributionRequestSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(() => updateLeadDistributionRequestSchema.parse({ enabled: 1 })).toThrow();
    expect(() => updateLeadDistributionRequestSchema.parse({ enabled: true, cursor: 99 })).toThrow();
  });

  it('keeps the unassigned queue shared while distribution is disabled', () => {
    expect(canActorViewLead(salesActor(false), {
      funnelId: 1,
      managerId: null,
      statusCode: 'new_request',
    })).toBe(true);
  });

  it('shows each manager only their own leads in the new stage when enabled', () => {
    const actor = salesActor(true);
    expect(canActorViewLead(actor, {
      funnelId: 1,
      managerId: null,
      statusCode: 'new_request',
    })).toBe(false);
    expect(canActorViewLead(actor, {
      funnelId: 1,
      managerId: 7,
      statusCode: 'new_request',
    })).toBe(true);
    expect(canActorViewLead(actor, {
      funnelId: 1,
      managerId: 8,
      statusCode: 'new_request',
    })).toBe(false);
    expect(canActorViewLead(actor, {
      funnelId: 1,
      managerId: null,
      statusCode: 'qualified',
    })).toBe(true);
  });

  it('keeps leadership and marketing visibility unchanged', () => {
    const lead = { funnelId: 1, managerId: null, statusCode: 'new_request' };
    expect(canActorViewLead(actorContextFrom({ id: 1, module: 'administration' }), lead)).toBe(true);
    expect(canActorViewLead(actorContextFrom({ id: 2, module: 'marketing' }), lead)).toBe(true);
  });

  it('uses the same unassigned-new-lead rule in SQL notification scopes', () => {
    const sql = unassignedLeadVisibleToSalesSql('lead');
    expect(sql).toContain("lead.status_code = 'new_request'");
    expect(sql).toContain('auto_lead_distribution_enabled = true');
    expect(sql).toContain('distribution_funnel.is_default = true');
  });
});

describe('automatic lead distribution persistence', () => {
  it('is disabled by default and serializes the round-robin cursor', () => {
    expect(migration).toContain('auto_lead_distribution_enabled boolean NOT NULL DEFAULT false');
    expect(migration).toContain('auto_lead_distribution_cursor bigint NOT NULL DEFAULT 0');
    expect(migration).toContain('LIMIT 1\n  FOR UPDATE');
    expect(migration).toContain('auto_lead_distribution_cursor % manager_count');
    expect(migration).toContain('auto_lead_distribution_cursor = auto_lead_distribution_cursor + 1');
  });

  it('selects only active main-funnel sales managers with an active hunter KPI', () => {
    expect(eligibilityMigration).toContain('CREATE OR REPLACE FUNCTION academy_next_auto_lead_manager');
    expect(eligibilityMigration).toContain("funnel.workflow_role = 'hunter'");
    expect(eligibilityMigration).toContain('funnel.is_default = true');
    expect(eligibilityMigration).toContain('employee.is_active = true');
    expect(eligibilityMigration).toContain('employee.is_archived = false');
    expect(eligibilityMigration).toContain('academy_sales_funnel_users assignment');
    expect(eligibilityMigration).toContain(
      "academy_kpi_employee_role(employee.id) IN ('hunter', 'full_cycle', 'full_cycle_3500')",
    );
  });

  it('assigns every unowned new lead source through one database trigger', () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF manager_id, status_code, funnel_id, is_archived');
    expect(migration).toContain("NEW.status_code = 'new_request'");
    expect(migration).toContain('NEW.manager_id := selected_manager');
  });

  it('registers the base and KPI eligibility migrations once and in order', () => {
    const entries = journal.entries.filter((entry: { tag: string }) => (
      entry.tag === '0113_auto_lead_distribution'
      || entry.tag === '0114_require_kpi_for_auto_lead_distribution'
    ));
    expect(entries).toHaveLength(2);
    expect(journal.entries.slice(-2)).toMatchObject([
      { idx: 113, tag: '0113_auto_lead_distribution' },
      { idx: 114, tag: '0114_require_kpi_for_auto_lead_distribution' },
    ]);
  });

  it('distributes the current queue on enable and exposes the admin toggle', () => {
    expect(route).toContain(
      "academy_kpi_employee_role(employee.id) IN ('hunter', 'full_cycle', 'full_cycle_3500')",
    );
    expect(route).toContain('WITH candidates AS MATERIALIZED');
    expect(route).toContain('ORDER BY lead.created_at, lead.id');
    expect(route).toContain('academy_next_auto_lead_manager(lead.funnel_id)');
    expect(route).toContain("router.patch('/sales-lead-distribution'");
    expect(settingsPage).toContain('<LeadDistributionPanel />');
    expect(panel).toContain('<Switch');
    expect(panel).toContain("t('autoLeadDistribution')");
  });
});
