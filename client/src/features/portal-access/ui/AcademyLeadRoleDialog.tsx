import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GraduationCap, UsersRound, ShieldCheck } from 'lucide-react';
import type { LearningModule } from '@shared/platform-routes';
import type { AcademyPortalCredentialResult, AcademyPortalLead, AcademyPortalLeadRole } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
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
const selectClassName = 'h-9 min-h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive disabled:opacity-50';

export function AcademyLeadRoleDialog({ lead, onClose, onGranted }: {
  lead: AcademyPortalLead; onClose: () => void; onGranted: (result: AcademyPortalCredentialResult, module: LearningModule) => void;
}) {
  const { t } = useTranslation();
  const active = useRef(true);
  const granting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
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
    onSettled: () => { granting.current = false; },
    mutationFn: (command: AcademyPortalLeadRole) => academyPortalApi.role(lead.id, command),
    onSuccess: (result, command) => { if (active.current) onGranted(result, command.role === 'representative' ? 'parent' : 'student'); },
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
  const grant = (command: AcademyPortalLeadRole) => {
    if (granting.current || mutation.isPending) return;
    granting.current = true;
    mutation.mutate(command);
  };
  const close = (open: boolean) => { if (!granting.current) guard.handleOpenChange(open); };
  const submit = () => {
    if (granting.current || mutation.isPending) return;
    clearValidation();
    if (role === 'self') {
      if (!studentId) { reject('academy-self-student', t('academyAccessChooseStudent')); return; }
      grant({ role, studentId: Number(studentId) });
      return;
    }
    if (role !== 'representative') { reject('academy-role-self', t('academyAccessRoleChoose')); return; }
    if (!selected.length) { reject(`academy-student-${lead.students[0]?.id}`, t('academyAccessStudentsRequired')); return; }
    const missingAge = selected.find(id => !classification[id]);
    if (missingAge !== undefined) { reject(`academy-age-${missingAge}`, t('academyAccessIdentityRequired')); return; }
    if (!confirmed) { reject('academy-relationship-confirmed', t('academyAccessRelationshipConfirmed')); return; }
    const missingConsent = selected.find(id => classification[id] === 'adult' && !consents[id]);
    if (missingConsent !== undefined) { reject(`academy-consent-${missingConsent}`, t('portalAdultConsentRequired')); return; }
    grant({
      role, relationship, relationshipConfirmed: true,
      students: selected.map(id => ({ studentId: id, classification: classification[id] as 'adult' | 'minor', adultConsent: Boolean(consents[id]) })),
    });
  };
  const invalidProps = (target: string) => ({
    'aria-invalid': validation?.target === target,
    'aria-describedby': validation?.target === target ? 'academy-role-error' : undefined,
  });

  return <>
    <Dialog open onOpenChange={close}>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="compact-modal-header">
          <DialogTitle>{t(lead.role === 'representative' ? 'academyAccessAddStudents' : 'academyAccessIssue')}</DialogTitle>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); submit(); }}>
          <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
            <DialogDescription className="break-words">{lead.name}</DialogDescription>
            <CompactModalSection title={t('academyAccessRole')} icon={GraduationCap} tone="sky" collapsible={false} disabled={mutation.isPending}>
            <fieldset className="space-y-3">
              <legend className="sr-only">{t('academyAccessRole')}</legend>
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
            </CompactModalSection>
            {role === 'self' && <CompactModalSection title={t('student')} icon={GraduationCap} tone="teal" collapsible={false} disabled={mutation.isPending} contentClassName="space-y-2">
              <Label htmlFor="academy-self-student">{t('academyAccessChooseStudent')}</Label>
              <select id="academy-self-student" className={selectClassName} value={studentId} disabled={mutation.isPending}
                {...invalidProps('academy-self-student')} onChange={event => { setStudentId(event.target.value); clearValidation(); }}>
                <option value="">{t('academyAccessChooseStudent')}</option>
                {lead.students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </CompactModalSection>}
            {role === 'representative' && <>
              <CompactModalSection title={t('lmsStaffRelationship')} icon={UsersRound} tone="teal" collapsible={false} disabled={mutation.isPending} contentClassName="space-y-2">
                <Label htmlFor="academy-parent-relationship">{t('lmsStaffRelationship')}</Label>
                <select id="academy-parent-relationship" className={selectClassName} value={relationship} disabled={mutation.isPending}
                  onChange={event => { setRelationship(event.target.value as typeof relationship); clearValidation(); }}>
                  <option value="parent">{t('lmsStaffParent')}</option>
                  <option value="guardian">{t('lmsStaffGuardian')}</option>
                  <option value="payer">{t('lmsStaffPayer')}</option>
                  <option value="other">{t('lmsStaffOther')}</option>
                </select>
              </CompactModalSection>
              <CompactModalSection title={t('academyAccessSelectedStudents').replace('{count}', String(selected.length))} icon={UsersRound} tone="violet" collapsible={false} disabled={mutation.isPending} contentClassName="space-y-3">
                {lead.students.map(student => {
                  const included = selected.includes(student.id);
                  return <div key={student.id} className={cn('overflow-hidden rounded-lg border', included && 'border-primary/30')}>
                    <label className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3 p-3 font-medium">
                      <Checkbox id={`academy-student-${student.id}`} checked={included} disabled={mutation.isPending} {...invalidProps(`academy-student-${student.id}`)}
                        onCheckedChange={checked => {
                          setSelected(current => checked === true ? [...new Set([...current, student.id])] : current.filter(id => id !== student.id));
                          clearValidation();
                        }} />
                      <span className="min-w-0 flex-1 break-words">{student.name}</span>
                      {student.classification !== 'unverified' && <Badge variant="secondary" className="shrink-0">{t(student.classification === 'minor' ? 'lmsStaffMinor' : 'lmsStaffAdult')}</Badge>}
                    </label>
                    {included && (student.classification === 'unverified' || classification[student.id] === 'adult') && <div className="space-y-3 border-t bg-muted/20 p-3">
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
              </CompactModalSection>
              <CompactModalSection title={t('accessVerificationSection')} icon={ShieldCheck} tone="amber" collapsible={false} disabled={mutation.isPending}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                <Checkbox id="academy-relationship-confirmed" className="mt-0.5" checked={confirmed} disabled={mutation.isPending}
                  {...invalidProps('academy-relationship-confirmed')} onCheckedChange={checked => { setConfirmed(checked === true); clearValidation(); }} />
                {t('academyAccessRelationshipConfirmed')}
              </label>
              </CompactModalSection>
            </>}
            {(validation || mutation.error) && <p id="academy-role-error" role="alert" className="text-sm text-destructive">{validation?.message || t(academyPortalError(mutation.error))}</p>}
          </div>
          <DialogFooter className="compact-modal-footer">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => close(false)}>{t('cancel')}</Button>
            <Button loading={mutation.isPending} type="submit" disabled={mutation.isPending || !role}>{t(mutation.isPending ? 'loading' : 'academyAccessIssue')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
