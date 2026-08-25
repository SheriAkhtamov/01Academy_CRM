import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import {
  countUnviewedLeads,
  leadViewStateAfterManagerTransfer,
  markLeadViewed,
} from '../server/services/lead-view-state';
import { countNewLeads, isNewLead } from '../client/src/components/ux/KanbanBoard';

const migration = readFileSync(
  new URL('../migrations/0077_add_lead_view_state.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const leadsRouter = readFileSync(
  new URL('../server/modules/academy/leads.router.ts', import.meta.url),
  'utf8',
);

const salesViewer = { id: 7, module: 'sales', modules: ['sales'] };
const leadershipViewer = { id: 1, module: 'administration', modules: ['administration'] };

describe('lead view-state migration', () => {
  it('stores who first opened a lead without making the columns required', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "first_viewed_at" timestamp');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "first_viewed_by" integer');
    expect(migration).toContain('REFERENCES "users"("id") ON DELETE SET NULL');
  });

  it('treats leads that existed before rollout as already seen', () => {
    // Without the backfill every card in the pipeline would light up red on the
    // first deploy, which is exactly the noise the marker is meant to avoid.
    expect(migration).toContain('UPDATE "academy_leads"');
    expect(migration).toContain('SET "first_viewed_at" = COALESCE("updated_at", "created_at", NOW())');
    expect(migration).toContain('WHERE "first_viewed_at" IS NULL');
  });

  it('indexes only the unviewed pipeline rows the badge counts', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "academy_leads_unviewed_idx"');
    expect(migration).toContain('WHERE "first_viewed_at" IS NULL AND COALESCE("is_archived", false) = false');
  });

  it('registers migration 0077 once after the Meta instant form migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 76)?.tag)
      .toBe('0076_add_meta_instant_form_attribution');
    expect(journal.entries.find((entry) => entry.idx === 77)?.tag)
      .toBe('0077_add_lead_view_state');
    expect(journal.entries.filter((entry) => entry.idx === 77)).toHaveLength(1);
  });
});

describe('unviewed lead counter', () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
  });

  it('counts only unviewed leads that are still in the pipeline', async () => {
    query.mockResolvedValue({ rows: [{ count: 3 }] });

    await expect(countUnviewedLeads(leadershipViewer, { query } as never)).resolves.toBe(3);

    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('lead.first_viewed_at IS NULL');
    expect(statement).toContain('COALESCE(lead.is_archived, false) = false');
    expect(statement).not.toContain('lead.manager_id = $1');
    expect(params).toEqual([]);
  });

  it('never announces leads a sales employee cannot open', async () => {
    query.mockResolvedValue({ rows: [{ count: 2 }] });

    await expect(countUnviewedLeads(salesViewer, { query } as never)).resolves.toBe(2);

    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('AND (lead.manager_id = $1 OR lead.manager_id IS NULL)');
    expect(params).toEqual([7]);
  });

  it('falls back to zero when the database returns no row', async () => {
    query.mockResolvedValue({ rows: [] });

    await expect(countUnviewedLeads(salesViewer, { query } as never)).resolves.toBe(0);
  });
});

describe('marking a lead as viewed', () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
  });

  it('keeps the first viewer and leaves updated_at alone', async () => {
    const firstViewedAt = new Date('2026-08-04T10:00:00.000Z');
    query.mockResolvedValue({ rows: [{ firstViewedAt, firstViewedBy: 7 }] });

    await expect(markLeadViewed(42, 9, { query } as never)).resolves.toEqual({
      leadId: 42,
      firstViewedAt,
      firstViewedBy: 7,
    });

    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('WHERE id = $1 AND first_viewed_at IS NULL');
    expect(statement).not.toContain('updated_at');
    expect(params).toEqual([42, 9]);
  });

  it('reports a still-new lead when the row disappeared', async () => {
    query.mockResolvedValue({ rows: [] });

    await expect(markLeadViewed(42, 9, { query } as never)).resolves.toEqual({
      leadId: 42,
      firstViewedAt: null,
      firstViewedBy: null,
    });
  });
});

describe('lead view-state after assignment', () => {
  it('makes a viewed lead new again for a different receiving manager', () => {
    expect(leadViewStateAfterManagerTransfer(3, 9)).toEqual({
      firstViewedAt: null,
      firstViewedBy: null,
    });
  });

  it('does not relight a lead when it is claimed or assigned to the same manager', () => {
    expect(leadViewStateAfterManagerTransfer(null, 9)).toEqual({});
    expect(leadViewStateAfterManagerTransfer(9, 9)).toEqual({});
  });
});

describe('lead view-state routes', () => {
  it('matches the literal count route before the lead id route', () => {
    const countRoute = leadsRouter.indexOf(`router.get('/leads/unviewed-count'`);
    const detailRoute = leadsRouter.indexOf(`router.get('/leads/:id'`);

    expect(countRoute).toBeGreaterThan(-1);
    expect(detailRoute).toBeGreaterThan(-1);
    expect(countRoute).toBeLessThan(detailRoute);
  });

  it('guards the view marker with lead access checks', () => {
    const viewRoute = leadsRouter.slice(leadsRouter.indexOf(`router.post('/leads/:id/view'`));
    expect(viewRoute).toContain('ensureModuleAccess(req, res, LEAD_MODULES');
    expect(viewRoute).toContain('ensureLeadRowAccess(req, res, lead)');
  });
});

describe('new lead marker on kanban cards', () => {
  it('marks a lead new until somebody opens its card', () => {
    expect(isNewLead({ firstViewedAt: null })).toBe(true);
    expect(isNewLead({ firstViewedAt: undefined })).toBe(true);
    expect(isNewLead({ firstViewedAt: '2026-08-04T10:00:00.000Z' })).toBe(false);
  });

  it('counts the new leads of a single column', () => {
    expect(countNewLeads([
      { id: 1, contactName: 'A', statusCode: 'new_request' },
      { id: 2, contactName: 'B', statusCode: 'new_request', firstViewedAt: '2026-08-04T10:00:00.000Z' },
      { id: 3, contactName: 'C', statusCode: 'new_request', firstViewedAt: null },
    ])).toBe(2);
  });
});
