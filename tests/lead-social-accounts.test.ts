import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  leadSocialAccountDeleteRequestSchema,
  leadSocialAccountRequestSchema,
} from '../shared/contracts/academy-leads';

const routes = readFileSync(
  new URL('../server/modules/academy/lead-social-accounts.router.ts', import.meta.url),
  'utf8',
);
const leadSelect = readFileSync(
  new URL('../server/modules/academy/academy-core.ts', import.meta.url),
  'utf8',
);
const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);
const editor = readFileSync(
  new URL('../client/src/components/ux/lead/LeadSocialAccountsEditor.tsx', import.meta.url),
  'utf8',
);

describe('lead social accounts', () => {
  it('accepts only supported networks and a single bounded value', () => {
    expect(leadSocialAccountRequestSchema.safeParse({
      channel: 'telegram',
      value: '@academy_support',
    }).success).toBe(true);
    expect(leadSocialAccountRequestSchema.safeParse({
      channel: 'linkedin',
      value: 'academy',
    }).success).toBe(false);
    expect(leadSocialAccountRequestSchema.safeParse({
      channel: 'instagram',
      value: '',
    }).success).toBe(false);
    expect(leadSocialAccountDeleteRequestSchema.safeParse({ assignToSelf: true }).success)
      .toBe(true);
  });

  it('protects system identities and serializes manual changes under the lead row lock', () => {
    expect(routes).toContain("router.post('/leads/:id/social-accounts'");
    expect(routes).toContain("router.patch('/leads/:id/social-accounts/:accountId'");
    expect(routes).toContain("router.delete('/leads/:id/social-accounts/:accountId'");
    expect(routes).toContain('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE');
    expect(routes).toContain("account.metadata?.source !== 'manual'");
    expect(routes).toContain('leadSocialAccountSystemManaged');
    expect(routes).toContain('leadSocialAccountDuplicate');
    expect(routes).toContain('leadSocialAccountLimitReached');
    expect(routes).toContain('leadAssignmentRequired');
    expect(routes).toContain('ASSIGN_ACADEMY_LEAD');
    expect(routes.indexOf('isScopedSalesUser && !lockedLead.managerId'))
      .toBeLessThan(routes.indexOf('!canMutateLeadRow(req.actor!, lockedLead)'));
    expect(leadSelect).toContain("'isManual', COALESCE(channel.metadata ->> 'source' = 'manual', false)");
  });

  it('keeps the editor inside the shared lead sheet with confirmations and assignment recovery', () => {
    expect(leadSheet).toContain('<LeadSocialAccountsEditor');
    expect(leadSheet).toContain('socialAccountsDirty');
    expect(editor).toContain('<Select');
    expect(editor).toContain('socialAccountLinkOrUsername');
    expect(editor).toContain('<AlertDialog');
    expect(editor).toContain('<AssignLeadToSelfDialog');
    expect(editor).toContain('normalizeLeadSocialAccountValue');
  });
});
