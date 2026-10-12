import { PortalDialogContent as DialogContent, PortalAlertDialogContent as AlertDialogContent } from '@/features/learning-content/modal-content';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { learningSchoolSettingsSchema, LEARNING_ACHIEVEMENT_RULES, type LearningSchoolSettings } from '@shared/contracts/learning-settings';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog,  DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useUnsavedChangesGuard, UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { learningRolloutApi } from './api';
import { lmsStaffKey } from '@/features/lms-staff/queries';
const weekdays: TranslationKey[] = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const awardLabels: Record<typeof LEARNING_ACHIEVEMENT_RULES[number],TranslationKey> = { first_accepted:'lmsAchievementFirstAccepted',first_project:'lmsAchievementFirstProject',section_completed:'lmsAchievementSectionCompleted',makeup_completed:'portalMakeupComplete',course_completed:'lmsAchievementCourseCompleted' };
export function SchoolSettingsCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(); const client = useQueryClient();
  const query = useQuery({ queryKey:['learning-school-settings'],queryFn:learningRolloutApi.schoolSettings,enabled });
  const [open,setOpen] = useState(false), [confirm,setConfirm] = useState(false), [draft,setDraft] = useState<LearningSchoolSettings | null>(null), [baseline,setBaseline] = useState<LearningSchoolSettings | null>(null), [holidays,setHolidays] = useState('');
  const [version,setVersion] = useState(0);
  const mutation = useMutation({ mutationFn:learningRolloutApi.updateSchoolSettings,onSuccess:data => { client.setQueryData(['learning-school-settings'],data); void client.invalidateQueries({queryKey:['learning-capabilities']}); void client.invalidateQueries({queryKey:lmsStaffKey}); setConfirm(false); setOpen(false); } });
  const pendingDraft = draft ? {...draft,workCalendar:{...draft.workCalendar,holidays:holidays.split(/\s+/).map(value => value.trim()).filter(Boolean)}} : null;
  const dirty = Boolean(open && pendingDraft && baseline && JSON.stringify(pendingDraft) !== JSON.stringify(baseline));
  const guard = useUnsavedChangesGuard({open,onOpenChange:setOpen,isDirty:dirty,isPending:mutation.isPending});
  const valid = learningSchoolSettingsSchema.safeParse(pendingDraft).success;
  const calendar = <K extends keyof LearningSchoolSettings['workCalendar']>(key:K,value:LearningSchoolSettings['workCalendar'][K]) => { if (draft) setDraft({...draft,workCalendar:{...draft.workCalendar,[key]:value}}); };
  const field = (name:'maxFileMiB'|'studentQuotaGiB'|'schoolQuotaGiB'|'materialAccessDays',label:TranslationKey,min:number,max:number,step=1) => <div className="space-y-2"><Label htmlFor={`school-${name}`}>{t(label)}</Label><Input id={`school-${name}`} type="number" min={min} max={max} step={step} value={draft?.[name] ?? ''} onChange={event => { if (draft) setDraft({...draft,[name]:event.target.value === '' && name === 'materialAccessDays' ? null : Number(event.target.value)}); }} /></div>;
  return <><section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">{t('lmsSettingsWorkCalendar')}</h2><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!enabled || query.isPending || query.isError} onClick={() => { if (query.data) { mutation.reset(); setDraft(structuredClone(query.data.settings)); setBaseline(structuredClone(query.data.settings)); setVersion(query.data.version); setHolidays(query.data.settings.workCalendar.holidays.join('\n')); setOpen(true); } }}>{t('lmsRolloutConfiguration')}</Button>{query.isError ? <Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button> : null}</div></section>
    <Dialog open={open} onOpenChange={guard.handleOpenChange}><DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{t('lmsRolloutConfiguration')}</DialogTitle></DialogHeader>{draft ? <>
      <div className="space-y-2">
        <Label htmlFor="school-default-format">{t('lmsSettingsDefaultFormat')}</Label>
        <select
          id="school-default-format"
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={draft.crmPreparation?.defaultFormat ?? ''}
          onChange={event => setDraft({
            ...draft,
            crmPreparation: {
              defaultFormat: (event.target.value || null) as LearningSchoolSettings['crmPreparation']['defaultFormat'],
            },
          })}
        >
          <option value="">{t('lmsSettingsFormatNotSet')}</option>
          <option value="offline">{t('lmsStaffOffline')}</option>
          <option value="online">{t('lmsStaffOnline')}</option>
        </select>
      </div>
      <Tabs defaultValue="files"><TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4"><TabsTrigger value="files">{t('lmsSettingsFiles')}</TabsTrigger><TabsTrigger value="calendar">{t('lmsSettingsWorkCalendar')}</TabsTrigger><TabsTrigger value="finance">{t('lmsSettingsFinancePolicy')}</TabsTrigger><TabsTrigger value="awards">{t('portalAchievements')}</TabsTrigger></TabsList>
      <TabsContent value="files" className="space-y-4 py-3">{field('maxFileMiB','lmsSettingsMaxFileMiB',1,100)}{field('studentQuotaGiB','lmsSettingsStudentQuotaGiB',0.1,80,0.1)}{field('schoolQuotaGiB','lmsSettingsSchoolQuotaGiB',0.1,80,0.1)}{field('materialAccessDays','lmsSettingsDefaultAccessDays',1,3650)}<label className="flex items-center gap-3"><Checkbox checked={draft.materialAccessDays === null} onCheckedChange={checked => setDraft({...draft,materialAccessDays:checked ? null : 365})}/>{t('lmsSettingsNoAccessLimit')}</label></TabsContent>
      <TabsContent value="calendar" className="space-y-5 py-3"><fieldset className="space-y-3"><legend className="mb-3 font-medium">{t('lmsSettingsWorkdays')}</legend><div className="grid gap-3 sm:grid-cols-2">{weekdays.map((key,index) => <label key={key} className="flex items-center gap-3"><Checkbox checked={draft.workCalendar.workdays.includes(index)} onCheckedChange={checked => calendar('workdays',checked ? [...draft.workCalendar.workdays,index].sort() : draft.workCalendar.workdays.filter(day => day !== index))}/>{t(key)}</label>)}</div></fieldset><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="school-work-start">{t('lmsSettingsWorkStart')}</Label><Input id="school-work-start" type="time" value={draft.workCalendar.start} onChange={event => calendar('start',event.target.value)}/></div><div className="space-y-2"><Label htmlFor="school-work-end">{t('lmsSettingsWorkEnd')}</Label><Input id="school-work-end" type="time" value={draft.workCalendar.end} onChange={event => calendar('end',event.target.value)}/></div></div><div className="space-y-2"><Label htmlFor="school-holidays">{t('lmsSettingsHolidays')}</Label><Textarea id="school-holidays" value={holidays} onChange={event => setHolidays(event.target.value)} /></div><fieldset className="space-y-3"><legend className="mb-3 font-medium">{t('lmsSettingsCoordinators')}</legend>{query.data?.employees.map(employee => <label key={employee.id} className="flex items-center gap-3"><Checkbox checked={draft.workCalendar.coordinatorUserIds.includes(employee.id)} onCheckedChange={checked => calendar('coordinatorUserIds',checked ? [...draft.workCalendar.coordinatorUserIds,employee.id] : draft.workCalendar.coordinatorUserIds.filter(id => id !== employee.id))}/>{employee.fullName}</label>)}</fieldset></TabsContent>
      <TabsContent value="finance" className="py-4"><label className="flex items-start gap-3"><Checkbox checked={draft.childFinanceVisible} onCheckedChange={checked => setDraft({...draft,childFinanceVisible:checked === true})}/>{t('lmsSettingsAllowChildPayments')}</label></TabsContent>
      <TabsContent value="awards" className="space-y-4 py-3"><h3 className="font-medium">{t('lmsSettingsAchievementTemplates')}</h3>{LEARNING_ACHIEVEMENT_RULES.map(rule => { const value = draft.achievementTemplates.find(item => item.rule === rule); const change = (field:'title'|'reason',text:string) => setDraft({...draft,achievementTemplates:draft.achievementTemplates.map(item => item.rule === rule ? {...item,[field]:text} : item)}); return <fieldset key={rule} className="space-y-3 rounded-lg border p-4"><label className="flex items-center gap-3 font-medium"><Checkbox checked={Boolean(value)} onCheckedChange={checked => setDraft({...draft,achievementTemplates:checked ? [...draft.achievementTemplates,{rule,title:t(awardLabels[rule]),reason:t(awardLabels[rule])}] : draft.achievementTemplates.filter(item => item.rule !== rule)})}/>{t(awardLabels[rule])}</label>{value ? <><div className="space-y-2"><Label htmlFor={`award-${rule}-title`}>{t('lmsSettingsName')}</Label><Input id={`award-${rule}-title`} value={value.title} onChange={event => change('title',event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`award-${rule}-reason`}>{t('lmsSettingsReason')}</Label><Textarea id={`award-${rule}-reason`} value={value.reason} onChange={event => change('reason',event.target.value)}/></div></> : null}</fieldset>; })}</TabsContent>
    </Tabs></> : null}<DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button><Button disabled={!valid || !dirty || mutation.isPending} onClick={() => { mutation.reset(); setConfirm(true); }}>{t('lmsRolloutSave')}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirm} onOpenChange={value => { if (!mutation.isPending) setConfirm(value); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('lmsSettingsSaveTitle')}</AlertDialogTitle><AlertDialogDescription>{t('lmsSettingsSaveBody')}</AlertDialogDescription></AlertDialogHeader>{mutation.isError ? <p role="alert" className="text-destructive">{t('lmsStaffSaveFailed')}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>{t('cancel')}</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending || !valid} onClick={event => { event.preventDefault(); if (pendingDraft) mutation.mutate({settings:pendingDraft,version}); }}>{t(mutation.isPending ? 'loading' : 'lmsRolloutSave')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges}/>
  </>;
}
