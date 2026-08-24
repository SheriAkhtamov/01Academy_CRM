import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);
const salesDashboard = readFileSync(
  new URL('../client/src/pages/sales-dashboard.tsx', import.meta.url),
  'utf8',
);
const studentDialog = readFileSync(
  new URL('../client/src/components/ux/CreateLeadStudentDialog.tsx', import.meta.url),
  'utf8',
);
const leadsApi = readFileSync(
  new URL('../client/src/features/leads/api.ts', import.meta.url),
  'utf8',
);
const telephonyWidget = readFileSync(
  new URL('../client/src/components/telephony/TelephonyWidget.tsx', import.meta.url),
  'utf8',
);
const toast = readFileSync(
  new URL('../client/src/components/ui/toast.tsx', import.meta.url),
  'utf8',
);

describe('lead and student UX separation', () => {
  it('keeps generic messenger and student enrollment fields out of lead forms', () => {
    for (const source of [leadSheet, salesDashboard]) {
      expect(source).not.toContain('name="messenger"');
      expect(source).not.toContain('name="studentName"');
      expect(source).not.toContain('name="studentAge"');
      expect(source).not.toContain('name="courseId"');
      expect(source).not.toContain('name="enrolledGroupId"');
    }
    expect(leadSheet).toContain('<LeadSocialAccountsEditor');
    expect(leadSheet).toContain('channels={lead.channels}');
  });

  it('provides an explicit multi-student creation flow with group enrollment', () => {
    expect(leadSheet).toContain('<CreateLeadStudentDialog');
    expect(studentDialog).toContain('groupIds: z.array(z.string()).min(1');
    expect(studentDialog).toContain('leadsApi.createStudent<CreatedLeadStudent>');
    expect(leadsApi).toContain('`/api/academy/leads/${leadId}/students`');
    expect(studentDialog).toContain('primaryGroupId: Number(values.primaryGroupId)');
  });

  it('keeps telephony interactive above dialogs and notifications above telephony', () => {
    expect(telephonyWidget).toContain('useMovableWidget<HTMLDivElement>');
    expect(telephonyWidget).toContain('data-telephony-widget');
    // Spread through `dockedDragProps`, which is `widgetDragProps` on a
    // pointer device and nothing on a phone — see telephony-widget-ux.
    expect(telephonyWidget).toContain('{...dockedDragProps}');
    expect(telephonyWidget).not.toContain('GripHorizontal');
    expect(telephonyWidget).not.toContain('dragHandleProps');
    expect(telephonyWidget).toContain('pointer-events-auto fixed z-[70]');
    expect(telephonyWidget).toContain('aria-modal="false"');
    expect(toast).toContain('pointer-events-none fixed top-0 z-[200]');
    expect(toast).toContain('group pointer-events-auto');
  });
});
