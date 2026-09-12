import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLeadStudentRequestSchema } from '../shared/contracts/academy-leads';

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
const leadStudentsCard = readFileSync(
  new URL('../client/src/components/ux/lead/LeadStudentsCard.tsx', import.meta.url),
  'utf8',
);
const leadsApi = readFileSync(
  new URL('../client/src/features/leads/api.ts', import.meta.url),
  'utf8',
);
const studentsApi = readFileSync(
  new URL('../client/src/features/students/api.ts', import.meta.url),
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

  it('provides an explicit multi-student creation flow with optional group enrollment', () => {
    expect(leadSheet).toContain('<LeadStudentsCard');
    expect(leadStudentsCard).toContain('<CreateLeadStudentDialog');
    expect(studentDialog).toContain('groupIds: z.array(z.string())');
    expect(studentDialog).toContain('value.groupIds.length > 0');
    expect(studentDialog).toContain('leadsApi.createStudent<CreatedLeadStudent>');
    expect(leadsApi).toContain('`/api/academy/leads/${leadId}/students`');
    expect(studentDialog).toContain("t('studentGroupCanBeAssignedLater')");
    expect(studentDialog).toContain('values.demoOnly || !values.primaryGroupId ? null : Number(values.primaryGroupId)');
    expect(studentDialog).toContain("t('createAndAddAnotherStudent')");
    expect(studentDialog).toContain('createAnother: true');
  });

  it('allows regular and demo student profiles to be created without a group', () => {
    expect(createLeadStudentRequestSchema.safeParse({
      studentName: 'Trial child',
      demoOnly: true,
    }).success).toBe(true);
    expect(createLeadStudentRequestSchema.safeParse({
      studentName: 'Regular child',
      groupIds: [],
      demoOnly: false,
    }).success).toBe(true);
    expect(createLeadStudentRequestSchema.safeParse({
      studentName: 'Invalid primary group',
      groupIds: [2],
      primaryGroupId: 3,
    }).success).toBe(false);
  });

  it('opens the creation-style edit dialog from every student in the lead modal', () => {
    expect(leadStudentsCard).toContain("t('edit')");
    expect(leadStudentsCard).toContain('<EditLeadStudentDialog');
    expect(leadStudentsCard).not.toContain('<StudentDetailSheet');
    expect(studentDialog).toContain('return <LeadStudentFormDialog {...props} mode="edit" purpose="enrollment" />');
    expect(studentDialog).toContain('studentName: editedStudent?.studentName');
    expect(studentDialog).toContain('studentAge: editedStudent?.studentAge');
    expect(studentDialog).toContain('phone: editedStudent?.phone');
    expect(studentDialog).toContain('studentsApi.updateDetails<CreatedLeadStudent>');
    expect(studentDialog).toContain('await studentsApi.addGroup(');
    expect(studentsApi).toContain('`/api/academy/students/${studentId}`');
  });

  it('keeps telephony above page content but below dialogs and sheets', () => {
    expect(telephonyWidget).toContain('useMovableWidget<HTMLDivElement>');
    expect(telephonyWidget).toContain('data-telephony-widget');
    // Spread through `dockedDragProps`, which is `widgetDragProps` on a
    // pointer device and nothing on a phone — see telephony-widget-ux.
    expect(telephonyWidget).toContain('{...dockedDragProps}');
    expect(telephonyWidget).not.toContain('GripHorizontal');
    expect(telephonyWidget).not.toContain('dragHandleProps');
    // Above the header and page content (z-30) but below Radix overlays
    // (z-50), so an open dialog or sheet never fights the widget.
    expect(telephonyWidget).toContain('pointer-events-auto fixed z-40');
    expect(telephonyWidget).not.toContain('z-[70]');
    expect(telephonyWidget).toContain('aria-modal="false"');
    expect(toast).toContain('pointer-events-none fixed top-0 z-[200]');
    expect(toast).toContain('group pointer-events-auto');
  });
});
