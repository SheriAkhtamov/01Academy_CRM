import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GraduationCap, UsersRound } from 'lucide-react';
import type { LearningModule } from '@shared/platform-routes';
import type { AcademyPortalCredentialResult, AcademyPortalLead, AcademyPortalLeadRole } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { academyPortalApi, academyPortalError } from '../academy-api';

type Classification = 'adult' | 'minor' | '';
type Validation = { target: string; message: string };
const selectClassName = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive disabled:opacity-50';

export function AcademyLeadRoleDialog({ lead, onClose, onGranted }: {
  lead: AcademyPortalLead; onClose: () => void; onGranted: (result: AcademyPortalCredentialResult, module: LearningModule) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<'self' | 'representative' | ''>(lead.role ?? '');
  const [studentId, setStudentId] = useState(lead.students.length === 1 ? String(lead.students[0].id) : '');
  const [selected, setSelected] = useState(lead.students.map(student => student.id));
  const [classification, setClassification] = useState<Record<number, Classification>>(() => Object.fromEntries(
    lead.students.map(student => [student.id, student.classification === 'unverified' ? '' : student.classification]),
  ));
  const [consents, setConsents] = useState<Record<number, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [relationship, setRelationship] = useState<'parent' | 'guardian' | 'payer' | 'other'>('parent');
  const [validation, setValidation] = useState<Validation | null>(null);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (command: AcademyPortalLeadRole) => academyPortalApi.role(lead.id, command),
    onSuccess: (result, command) => onGranted(result, command.role === 'representative' ? 'parent' : 'student'),
  });
  const dirty = role !== (lead.role ?? '') || studentId !== (lead.students.length === 1 ? String(lead.students[0].id) : '')
    || confirmed || relationship !== 'parent' || selected.length !== lead.students.length || Object.values(consents).some(Boolean)
    || lead.students.some(student => classification[student.id] !== (student.classification === 'unverified' ? '' : student.classification));
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: mutation.isPending, onOpenChange: open => { if (!open) onClose(); } });
  const reject = (target: string, message: string) => {
    setValidation({ target, message });
    document.getElementById(target)?.focus();
  };
  const clearValidation = () => { setValidation(null); mutation.reset(); };
  const submit = () => {
    if (mutation.isPending) return;
    clearValidation();
    if (role === 'self') {
      if (!studentId) { reject('academy-self-student', t('academyAccessChooseStudent')); return; }
      mutation.mutate({ role, studentId: Number(studentId) });
      return;
    }
    if (role !== 'representative') { reject('academy-role-self', t('academyAccessRoleChoose')); return; }
    if (!selected.length) { reject(`academy-student-${lead.students[0]?.id}`, t('academyAccessStudentsRequired')); return; }
    const missingAge = selected.find(id => !classification[id]);
    if (missingAge !== undefined) { reject(`academy-age-${missingAge}`, t('academyAccessIdentityRequired')); return; }
    if (!confirmed) { reject('academy-relationship-confirmed', t('academyAccessRelationshipConfirmed')); return; }
    const missingConsent = selected.find(id => classification[id] === 'adult' && !consents[id]);
    if (missingConsent !== undefined) { reject(`academy-consent-${missingConsent}`, t('portalAdultConsentRequired')); return; }
    mutation.mutate({
      role, relationship, relationshipConfirmed: true,
      students: selected.map(id => ({ studentId: id, classification: classification[id] as 'adult' | 'minor', adultConsent: Boolean(consents[id]) })),
    });
  };
  const invalidProps = (target: string) => ({
    'aria-invalid': validation?.target === target,
    'aria-describedby': validation?.target === target ? 'academy-role-error' : undefined,
  });

  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pr-12">
          <DialogTitle>{t(lead.role === 'representative' ? 'academyAccessAddStudents' : 'academyAccessIssue')}</DialogTitle>
          <DialogDescription className="break-words">{lead.name}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); submit(); }}>
          <div className="space-y-5 overflow-y-auto p-6">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t('academyAccessRole')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['self', 'representative'] as const).map(value => {
                  const Icon = value === 'self' ? GraduationCap : UsersRound;
                  return <label key={value} className={cn(
                    'flex min-h-16 items-center gap-3 rounded-lg border p-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring',
                    role === value ? 'border-primary bg-primary/5' : 'border-border',
                    lead.role || mutation.isPending ? 'cursor-default' : 'cursor-pointer hover:border-primary/50',
                  )}>
                    <input id={`academy-role-${value}`} type="radio" name="academy-lead-role" value={value} checked={role === value}
                      disabled={Boolean(lead.role) || mutation.isPending} className="size-4 shrink-0 accent-primary" {...invalidProps(`academy-role-${value}`)}
                      onChange={() => { setRole(value); clearValidation(); }} />
                    <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                    {t(value === 'self' ? 'academyAccessRoleSelf' : 'academyAccessRoleRepresentative')}
                  </label>;
                })}
              </div>
            </fieldset>
            {role === 'self' && <div className="space-y-2">
              <Label htmlFor="academy-self-student">{t('academyAccessChooseStudent')}</Label>
              <select id="academy-self-student" className={selectClassName} value={studentId} disabled={mutation.isPending}
                {...invalidProps('academy-self-student')} onChange={event => { setStudentId(event.target.value); clearValidation(); }}>
                <option value="">{t('academyAccessChooseStudent')}</option>
                {lead.students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </div>}
            {role === 'representative' && <>
              <div className="space-y-2">
                <Label htmlFor="academy-parent-relationship">{t('lmsStaffRelationship')}</Label>
                <select id="academy-parent-relationship" className={selectClassName} value={relationship} disabled={mutation.isPending}
                  onChange={event => { setRelationship(event.target.value as typeof relationship); clearValidation(); }}>
                  <option value="parent">{t('lmsStaffParent')}</option>
                  <option value="guardian">{t('lmsStaffGuardian')}</option>
                  <option value="payer">{t('lmsStaffPayer')}</option>
                  <option value="other">{t('lmsStaffOther')}</option>
                </select>
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-sm font-medium">{t('academyAccessSelectedStudents').replace('{count}', String(selected.length))}</legend>
                {lead.students.map(student => {
                  const included = selected.includes(student.id);
                  return <div key={student.id} className={cn('overflow-hidden rounded-lg border', included && 'border-primary/30')}>
                    <label className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3 p-4 font-medium">
                      <Checkbox id={`academy-student-${student.id}`} checked={included} disabled={mutation.isPending} {...invalidProps(`academy-student-${student.id}`)}
                        onCheckedChange={checked => {
                          setSelected(current => checked === true ? [...new Set([...current, student.id])] : current.filter(id => id !== student.id));
                          clearValidation();
                        }} />
                      <span className="min-w-0 flex-1 break-words">{student.name}</span>
                      {student.classification !== 'unverified' && <Badge variant="secondary" className="shrink-0">{t(student.classification === 'minor' ? 'lmsStaffMinor' : 'lmsStaffAdult')}</Badge>}
                    </label>
                    {included && (student.classification === 'unverified' || classification[student.id] === 'adult') && <div className="space-y-3 border-t bg-muted/20 p-4">
                      {student.classification === 'unverified' && <div className="space-y-2">
                        <Label htmlFor={`academy-age-${student.id}`}>{t('academyAccessAge')}</Label>
                        <select id={`academy-age-${student.id}`} className={selectClassName} value={classification[student.id]} disabled={mutation.isPending}
                          {...invalidProps(`academy-age-${student.id}`)} onChange={event => {
                            setClassification(current => ({ ...current, [student.id]: event.target.value as Classification }));
                            setConsents(current => ({ ...current, [student.id]: false }));
                            clearValidation();
                          }}>
                          <option value="">{t('academyAccessAge')}</option>
                          <option value="minor">{t('lmsStaffMinor')}</option>
                          <option value="adult">{t('lmsStaffAdult')}</option>
                        </select>
                      </div>}
                      {classification[student.id] === 'adult' && <label className="flex min-h-10 cursor-pointer items-start gap-3 py-2 text-sm">
                        <Checkbox id={`academy-consent-${student.id}`} className="mt-0.5" checked={Boolean(consents[student.id])} disabled={mutation.isPending}
                          {...invalidProps(`academy-consent-${student.id}`)} onCheckedChange={checked => {
                            setConsents(current => ({ ...current, [student.id]: checked === true })); clearValidation();
                          }} />
                        {t('academyAccessAdultConsent')}
                      </label>}
                    </div>}
                  </div>;
                })}
              </fieldset>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm">
                <Checkbox id="academy-relationship-confirmed" className="mt-0.5" checked={confirmed} disabled={mutation.isPending}
                  {...invalidProps('academy-relationship-confirmed')} onCheckedChange={checked => { setConfirmed(checked === true); clearValidation(); }} />
                {t('academyAccessRelationshipConfirmed')}
              </label>
            </>}
            {(validation || mutation.error) && <p id="academy-role-error" role="alert" className="text-sm text-destructive">{validation?.message || t(academyPortalError(mutation.error))}</p>}
          </div>
          <DialogFooter className="shrink-0 border-t bg-background p-4">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={mutation.isPending || !role}>{t(mutation.isPending ? 'loading' : 'academyAccessIssue')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
