import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangeField } from '@/components/ux/DateRangeField';
import { PageHeader } from '@/components/ux/PageHeader';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { formatAcademyDate } from '@/lib/localeFormat';
import { MODULE_NAVIGATION } from '@/lib/moduleNavigation';
import type { AcademyModule } from '@shared/academy';

interface AuditLog {
  id: number;
  userId?: number | null;
  userName?: string | null;
  userModule?: AcademyModule | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  createdAt: string;
}

interface AuditData {
  logs: AuditLog[];
  integrationLogs: Array<{
    id: number;
    provider: string;
    direction: string;
    status: string;
    errorMessage?: string | null;
    payload?: unknown;
    retryCount: number;
    createdAt: string;
  }>;
  employees: Array<{ id: number; fullName: string; module: AcademyModule }>;
  pagination: {
    audit: PaginationMeta;
    integrations: PaginationMeta;
  };
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type AuditCopy = ReturnType<typeof useCeoCopy>['audit'];
type Translate = (key: TranslationKey) => string;

const integrationCodeLabel = (code: string) => code
  .split('_')
  .filter(Boolean)
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join(' ');

const actionLabel = (action: string, copy: AuditCopy, t: Translate) => {
  if (action.startsWith('CREATE')) return copy.created;
  if (action.startsWith('DELETE')) return copy.deleted;
  if (action.includes('REFUND')) return copy.refund;
  if (action.includes('APPROVE')) return copy.approved;
  if (action.startsWith('UPDATE')) return copy.changed;
  return `${t('auditAction')} (${action})`;
};

const entityLabel = (entity: string, copy: AuditCopy, t: Translate) => ({
  academy_lead: copy.lead, academy_leads: copy.lead, academy_student: copy.student, academy_students: copy.student,
  academy_payment: copy.payment, academy_payments: copy.payment, academy_group: copy.group, academy_groups: copy.group,
  academy_lesson: copy.schedule, academy_lessons: copy.schedule, academy_marketing_expense: copy.expense,
  academy_task: copy.task, academy_company_settings: copy.kpi,
}[entity] ?? `${t('auditObject')} (${entity})`);

const integrationStatusLabel = (status: string, t: Translate) => ({
  failed: t('integrationStatusFailed'),
  connected: t('integrationStatusConnected'),
  sent: t('messageSent'),
  pending: t('integrationStatusPending'),
  completed: t('integrationStatusCompleted'),
} as Record<string, string>)[status] ?? integrationCodeLabel(status);

const integrationProviderLabel = (provider: string, t: Translate) => (
  provider === 'website' ? t('integrationProviderWebsite') : integrationCodeLabel(provider)
);
const jsonObject = (value: unknown): Record<string, unknown> => {
  const unwrapped = Array.isArray(value) ? value[0] : value;
  if (!unwrapped || typeof unwrapped !== 'object') return {};
  return unwrapped as Record<string, unknown>;
};

const presentValue = (value: unknown, copy: AuditCopy) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? copy.yes : copy.no;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default function AuditPage() {
  const ceoCopy = useCeoCopy();
  const { t, language } = useTranslation();
  const [tab, setTab] = useState('audit');
  const [userId, setUserId] = useState('all');
  const [action, setAction] = useState('all');
  const [entityType, setEntityType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditLimit, setAuditLimit] = useState(25);
  const [integrationPage, setIntegrationPage] = useState(1);
  const [integrationLimit, setIntegrationLimit] = useState(25);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (userId !== 'all') params.set('userId', userId);
    if (action !== 'all') params.set('action', action);
    if (entityType !== 'all') params.set('entityType', entityType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('auditPage', String(auditPage));
    params.set('auditLimit', String(auditLimit));
    params.set('integrationPage', String(integrationPage));
    params.set('integrationLimit', String(integrationLimit));
    return `/api/academy/audit?${params.toString()}`;
  }, [action, auditLimit, auditPage, entityType, from, integrationLimit, integrationPage, to, userId]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditData>({
    queryKey: ['academy-audit', queryUrl],
    queryFn: () => apiRequest('GET', queryUrl),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const totalPages = data?.pagination.audit.totalPages;
    if (totalPages && auditPage > totalPages) setAuditPage(totalPages);
  }, [auditPage, data?.pagination.audit.totalPages]);

  useEffect(() => {
    const totalPages = data?.pagination.integrations.totalPages;
    if (totalPages && integrationPage > totalPages) setIntegrationPage(totalPages);
  }, [data?.pagination.integrations.totalPages, integrationPage]);

  const resetFilters = () => {
    setUserId('all');
    setAction('all');
    setEntityType('all');
    setFrom('');
    setTo('');
    setAuditPage(1);
  };
  const oldValues = selected ? jsonObject(selected.oldValues) : {};
  const newValues = selected ? jsonObject(selected.newValues) : {};
  const changedFields = selected ? [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])] : [];
  const auditPagination = data?.pagination.audit ?? {
    page: auditPage,
    limit: auditLimit,
    total: 0,
    totalPages: 1,
  };
  const integrationPagination = data?.pagination.integrations ?? {
    page: integrationPage,
    limit: integrationLimit,
    total: 0,
    totalPages: 1,
  };

  return (
    <ModulePage contained>
      <PageHeader
        title={ceoCopy.audit.title}
        subtitle={ceoCopy.audit.subtitle}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.administration.nameKey), href: '/admin' },
          { label: ceoCopy.audit.title },
        ]}
        actions={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={isFetching ? 'animate-spin' : ''} data-icon="inline-start" />{ceoCopy.audit.refresh}</Button>}
      />

      <ModulePageBody contained ariaLabel={ceoCopy.audit.title}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="audit">{ceoCopy.audit.history}</TabsTrigger>
          <TabsTrigger value="integrations">{ceoCopy.audit.integrations}</TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="mt-5 space-y-5">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_2.2fr_auto] xl:items-end">
              <div className="space-y-1.5"><Label htmlFor="audit-filter-employee">{ceoCopy.audit.employee}</Label><Select value={userId} onValueChange={(value) => { setUserId(value); setAuditPage(1); }}><SelectTrigger id="audit-filter-employee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{ceoCopy.audit.allEmployees}</SelectItem>{(data?.employees ?? []).map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.fullName}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="audit-filter-action">{ceoCopy.audit.action}</Label><Select value={action} onValueChange={(value) => { setAction(value); setAuditPage(1); }}><SelectTrigger id="audit-filter-action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{ceoCopy.audit.allActions}</SelectItem><SelectItem value="CREATE">{ceoCopy.audit.created}</SelectItem><SelectItem value="UPDATE">{ceoCopy.audit.changed}</SelectItem><SelectItem value="DELETE">{ceoCopy.audit.deleted}</SelectItem><SelectItem value="REFUND">{ceoCopy.audit.refund}</SelectItem><SelectItem value="APPROVE">{ceoCopy.audit.approved}</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="audit-filter-object">{ceoCopy.audit.object}</Label><Select value={entityType} onValueChange={(value) => { setEntityType(value); setAuditPage(1); }}><SelectTrigger id="audit-filter-object"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{ceoCopy.audit.allObjects}</SelectItem><SelectItem value="academy_lead">{ceoCopy.audit.leads}</SelectItem><SelectItem value="academy_student">{ceoCopy.audit.students}</SelectItem><SelectItem value="academy_payment">{ceoCopy.audit.payments}</SelectItem><SelectItem value="academy_group">{ceoCopy.audit.groups}</SelectItem><SelectItem value="academy_lesson">{ceoCopy.audit.schedule}</SelectItem></SelectContent></Select></div>
              <DateRangeField
                idPrefix="audit-filter"
                fromLabel={ceoCopy.audit.fromDate}
                toLabel={ceoCopy.audit.toDate}
                value={{ from, to }}
                onChange={(range) => { setFrom(range.from); setTo(range.to); setAuditPage(1); }}
              />
              <Button variant="ghost" onClick={resetFilters}><RotateCcw data-icon="inline-start" />{ceoCopy.audit.reset}</Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70 pb-4"><CardTitle>{ceoCopy.audit.history}</CardTitle><CardDescription>{isLoading ? ceoCopy.audit.loading : `${ceoCopy.audit.shown} ${auditPagination.total} ${ceoCopy.audit.lastEvents}`}</CardDescription></CardHeader>
            <CardContent className="p-0">
              {/*
                A 900px table on a 375px screen is six columns of horizontal
                drag with the header scrolled out of sight. Below `md` each
                entry is a card instead — the same six values, stacked, with
                the whole card opening the change sheet.
              */}
              <ul className="divide-y divide-border/60 md:hidden">
                {(data?.logs ?? []).map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-muted/40"
                      onClick={() => setSelected(log)}
                      aria-label={ceoCopy.audit.viewChanges}
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={log.action.startsWith('DELETE') ? 'destructive' : log.action.includes('APPROVE') ? 'success' : 'outline'}>
                            {actionLabel(log.action, ceoCopy.audit, t)}
                          </Badge>
                          <span className="text-sm font-medium">{entityLabel(log.entityType, ceoCopy.audit, t)}</span>
                          {log.entityId ? <span className="text-sm text-muted-foreground">#{log.entityId}</span> : null}
                        </div>
                        <p className="truncate text-sm">{log.userName ?? ceoCopy.audit.system}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {Object.keys(jsonObject(log.newValues)).slice(0, 3).join(', ') || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatAcademyDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
                {isError ? (
                  <li className="px-4 py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-destructive"><AlertCircle className="size-4" />{t('failedToLoadData')}</span>
                    <Button className="ml-3" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>{t('retry')}</Button>
                  </li>
                ) : null}
                {!isLoading && !isError && (data?.logs.length ?? 0) === 0 ? (
                  <li className="px-4 py-12 text-center text-muted-foreground">{ceoCopy.audit.noResults}</li>
                ) : null}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">{ceoCopy.audit.date}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.employee}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.action}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.object}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.changes}</th><th className="w-12 px-3 py-3" /></tr></thead>
                  <tbody>
                    {(data?.logs ?? []).map((log) => <tr key={log.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30"><td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatAcademyDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}</td><td className="px-5 py-3"><p className="font-medium">{log.userName ?? ceoCopy.audit.system}</p><p className="text-xs text-muted-foreground">{log.userModule ?? '—'}</p></td><td className="px-5 py-3"><Badge variant={log.action.startsWith('DELETE') ? 'destructive' : log.action.includes('APPROVE') ? 'success' : 'outline'}>{actionLabel(log.action, ceoCopy.audit, t)}</Badge></td><td className="px-5 py-3"><span className="font-medium">{entityLabel(log.entityType, ceoCopy.audit, t)}</span>{log.entityId ? <span className="ml-1 text-muted-foreground">#{log.entityId}</span> : null}</td><td className="max-w-64 truncate px-5 py-3 text-muted-foreground">{Object.keys(jsonObject(log.newValues)).slice(0, 3).join(', ') || '—'}</td><td className="px-3 py-3"><Button size="icon" variant="ghost" onClick={() => setSelected(log)} aria-label={ceoCopy.audit.viewChanges}><ChevronRight /></Button></td></tr>)}
                    {isError ? <tr><td colSpan={6} className="px-5 py-12 text-center"><span className="inline-flex items-center gap-2 text-destructive"><AlertCircle className="size-4" />{t('failedToLoadData')}</span><Button className="ml-3" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>{t('retry')}</Button></td></tr> : null}
                    {!isLoading && !isError && (data?.logs.length ?? 0) === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">{ceoCopy.audit.noResults}</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={auditPagination.page}
                pageSize={auditPagination.limit}
                totalItems={auditPagination.total}
                disabled={isFetching}
                onPageChange={setAuditPage}
                onPageSizeChange={(limit) => {
                  setAuditLimit(limit);
                  setAuditPage(1);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-5">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle>{ceoCopy.audit.integrationLogs}</CardTitle><CardDescription>{ceoCopy.audit.integrationDescription}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border/60 md:hidden">
                {(data?.integrationLogs ?? []).map((log) => (
                  <li key={log.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{integrationProviderLabel(log.provider, t)}</span>
                      <Badge variant={log.status === 'failed' ? 'destructive' : log.status === 'connected' || log.status === 'sent' ? 'success' : 'warning'}>{integrationStatusLabel(log.status, t)}</Badge>
                    </div>
                    <p className="break-words text-xs text-muted-foreground">
                      {log.errorMessage || (log.payload ? JSON.stringify(log.payload) : ceoCopy.audit.noErrors)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatAcademyDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </li>
                ))}
                {isError ? (
                  <li className="px-4 py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-destructive"><AlertCircle className="size-4" />{t('failedToLoadData')}</span>
                  </li>
                ) : null}
                {!isLoading && !isError && (data?.integrationLogs.length ?? 0) === 0 ? (
                  <li className="px-4 py-12 text-center text-muted-foreground">{ceoCopy.audit.noIntegrationLogs}</li>
                ) : null}
              </ul>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">{ceoCopy.audit.source}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.status}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.message}</th><th className="px-5 py-3 font-medium">{ceoCopy.audit.time}</th></tr></thead><tbody>{(data?.integrationLogs ?? []).map((log) => <tr key={log.id} className="border-b border-border/60 last:border-0"><td className="px-5 py-3 font-medium">{integrationProviderLabel(log.provider, t)}</td><td className="px-5 py-3"><Badge variant={log.status === 'failed' ? 'destructive' : log.status === 'connected' || log.status === 'sent' ? 'success' : 'warning'}>{integrationStatusLabel(log.status, t)}</Badge></td><td className="max-w-xl px-5 py-3 text-muted-foreground">{log.errorMessage || (log.payload ? JSON.stringify(log.payload) : ceoCopy.audit.noErrors)}</td><td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatAcademyDate(log.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}</td></tr>)}{isError ? <tr><td colSpan={4} className="px-5 py-12 text-center"><span className="inline-flex items-center gap-2 text-destructive"><AlertCircle className="size-4" />{t('failedToLoadData')}</span></td></tr> : null}{!isLoading && !isError && (data?.integrationLogs.length ?? 0) === 0 ? <tr><td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">{ceoCopy.audit.noIntegrationLogs}</td></tr> : null}</tbody></table></div>
              <PaginationControls
                page={integrationPagination.page}
                pageSize={integrationPagination.limit}
                totalItems={integrationPagination.total}
                disabled={isFetching}
                onPageChange={setIntegrationPage}
                onPageSizeChange={(limit) => {
                  setIntegrationLimit(limit);
                  setIntegrationPage(1);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </ModulePageBody>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{ceoCopy.audit.recordChanges}</SheetTitle><SheetDescription>{selected ? `${entityLabel(selected.entityType, ceoCopy.audit, t)} #${selected.entityId ?? '—'} · ${formatAcademyDate(selected.createdAt, language, { dateStyle: 'short', timeStyle: 'short' })}` : ''}</SheetDescription></SheetHeader>
          {/*
            Field / before / after reads as three columns only when there is
            room for three. On a phone the header strip is dropped and each
            field becomes its own block, with the two values labelled in place —
            140px + two value columns would otherwise leave about 90px each,
            which is not enough to tell an old value from a new one.
          */}
          {selected ? <div className="mt-6 overflow-hidden rounded-lg border border-border/70"><div className="hidden grid-cols-[140px_1fr_1fr] border-b border-border/70 bg-muted/30 text-xs font-medium text-muted-foreground sm:grid"><div className="p-3">{ceoCopy.audit.field}</div><div className="border-l border-border/70 p-3">{ceoCopy.audit.before}</div><div className="border-l border-border/70 p-3">{ceoCopy.audit.after}</div></div>{changedFields.length ? changedFields.map((field) => <div key={field} className="border-b border-border/60 text-sm last:border-0 sm:grid sm:grid-cols-[140px_1fr_1fr]"><div className="break-words p-3 font-medium">{field}</div><div className="break-words px-3 pb-2 text-muted-foreground sm:border-l sm:border-border/60 sm:p-3"><span className="mr-1.5 text-xs uppercase tracking-wide text-muted-foreground/70 sm:hidden">{ceoCopy.audit.before}</span>{presentValue(oldValues[field], ceoCopy.audit)}</div><div className="break-words px-3 pb-3 sm:border-l sm:border-border/60 sm:p-3"><span className="mr-1.5 text-xs uppercase tracking-wide text-muted-foreground/70 sm:hidden">{ceoCopy.audit.after}</span>{presentValue(newValues[field], ceoCopy.audit)}</div></div>) : <div className="p-6 text-sm text-muted-foreground">{ceoCopy.audit.noDiff}</div>}</div> : null}
        </SheetContent>
      </Sheet>
    </ModulePage>
  );
}
