import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AcademyPortalCredentialResult, AcademyPortalLead, AcademyPortalLeadRole } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { academyPortalApi, academyPortalError } from '../academy-api';

export function AcademyLeadRoleDialog({ lead, onClose, onGranted }: {
  lead: AcademyPortalLead; onClose: () => void; onGranted: (result: AcademyPortalCredentialResult) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<'self' | 'representative' | ''>(lead.role ?? '');
  const [studentId, setStudentId] = useState(lead.students.length === 1 ? String(lead.students[0].id) : '');
  const [selected, setSelected] = useState(lead.students.map(student => student.id));
  const [classification, setClassification] = useState<Record<number, 'adult' | 'minor' | ''>>(Object.fromEntries(lead.students.map(student => [student.id, student.classification === 'unverified' ? '' : student.classification])));
  const [consents, setConsents] = useState<Record<number, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [relationship, setRelationship] = useState<'parent' | 'guardian' | 'payer' | 'other'>('parent');
  const [validation, setValidation] = useState('');
  const mutation = useMutation({ gcTime: 0, mutationFn: (command: AcademyPortalLeadRole) => academyPortalApi.role(lead.id, command), onSuccess: onGranted });
  const dirty = role !== (lead.role ?? '') || studentId !== (lead.students.length === 1 ? String(lead.students[0].id) : '') || confirmed || relationship !== 'parent' || selected.length !== lead.students.length || Object.values(consents).some(Boolean) || lead.students.some(student => classification[student.id] !== (student.classification === 'unverified' ? '' : student.classification));
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: mutation.isPending, onOpenChange: open => { if (!open) onClose(); } });
  const submit = () => {
    setValidation('');
    if (role === 'self') {
      if (!studentId) { setValidation(t('academyAccessChooseStudent')); return; }
      mutation.mutate({ role, studentId: Number(studentId) });
      return;
    }
    if (role !== 'representative') { setValidation(t('academyAccessRoleChoose')); return; }
    if (!selected.length || selected.some(id => !classification[id])) { setValidation(t('academyAccessIdentityRequired')); return; }
    if (!confirmed) { setValidation(t('academyAccessRelationshipConfirmed')); return; }
    if (selected.some(id => classification[id] === 'adult' && !consents[id])) { setValidation(t('portalAdultConsentRequired')); return; }
    mutation.mutate({ role, relationship, relationshipConfirmed: true,
      students: selected.map(id => ({ studentId: id, classification: classification[id] as 'adult' | 'minor', adultConsent: Boolean(consents[id]) })) });
  };
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{t('academyAccessLeadAccount')}</DialogTitle><DialogDescription>{lead.name}</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="space-y-2"><Label htmlFor="academy-lead-role">{t('academyAccessRole')}</Label>
          <select id="academy-lead-role" className="min-h-11 w-full rounded-md border bg-background px-3" value={role} disabled={Boolean(lead.role) || mutation.isPending} onChange={event => setRole(event.target.value as typeof role)}>
            <option value="">{t('academyAccessRoleChoose')}</option><option value="self">{t('academyAccessRoleSelf')}</option><option value="representative">{t('academyAccessRoleRepresentative')}</option>
          </select>
        </div>
        {role === 'self' && <div className="space-y-2"><Label htmlFor="academy-self-student">{t('academyAccessChooseStudent')}</Label>
          <select id="academy-self-student" className="min-h-11 w-full rounded-md border bg-background px-3" value={studentId} disabled={mutation.isPending} onChange={event => setStudentId(event.target.value)}>
            <option value="">{t('academyAccessChooseStudent')}</option>{lead.students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}
          </select>
        </div>}
        {role === 'representative' && <>
          <div className="space-y-2"><Label htmlFor="academy-parent-relationship">{t('lmsStaffRelationship')}</Label><select id="academy-parent-relationship" className="min-h-11 w-full rounded-md border bg-background px-3" value={relationship} disabled={mutation.isPending} onChange={event => setRelationship(event.target.value as typeof relationship)}>
            <option value="parent">{t('lmsStaffParent')}</option><option value="guardian">{t('lmsStaffGuardian')}</option><option value="payer">{t('lmsStaffPayer')}</option><option value="other">{t('lmsStaffOther')}</option>
          </select></div>
          <div className="space-y-4">{lead.students.map(student => <fieldset key={student.id} className="space-y-3 rounded-lg border p-4">
            <label className="flex items-center gap-3 font-medium"><Checkbox checked={selected.includes(student.id)} disabled={mutation.isPending} onCheckedChange={checked => setSelected(current => checked ? [...new Set([...current, student.id])] : current.filter(id => id !== student.id))} />{student.name}</label>
            {selected.includes(student.id) && <>
              <div className="space-y-2"><Label htmlFor={`academy-age-${student.id}`}>{t('academyAccessAge')}</Label>
                <select id={`academy-age-${student.id}`} className="min-h-11 w-full rounded-md border bg-background px-3" value={classification[student.id]} disabled={student.classification !== 'unverified' || mutation.isPending} onChange={event => setClassification(current => ({ ...current, [student.id]: event.target.value as 'adult' | 'minor' | '' }))}>
                  <option value="">{t('academyAccessAge')}</option><option value="minor">{t('lmsStaffMinor')}</option><option value="adult">{t('lmsStaffAdult')}</option>
                </select>
              </div>
              {classification[student.id] === 'adult' && <label className="flex items-start gap-3"><Checkbox checked={Boolean(consents[student.id])} disabled={mutation.isPending} onCheckedChange={checked => setConsents(current => ({ ...current, [student.id]: checked === true }))} />{t('academyAccessAdultConsent')}</label>}
            </>}
          </fieldset>)}</div>
          <label className="flex items-start gap-3"><Checkbox checked={confirmed} disabled={mutation.isPending} onCheckedChange={checked => setConfirmed(checked === true)} />{t('academyAccessRelationshipConfirmed')}</label>
        </>}
        {(validation || mutation.error) && <p role="alert" className="text-sm text-destructive">{validation || t(academyPortalError(mutation.error))}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={mutation.isPending || !role}>{t(mutation.isPending ? 'loading' : 'academyAccessIssue')}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
