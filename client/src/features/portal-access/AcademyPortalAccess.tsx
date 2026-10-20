import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw, Search, UserRoundPlus, X } from 'lucide-react';
import type { LearningModule } from '@shared/platform-routes';
import type { AcademyPortalAccount, AcademyPortalCredentialResult, AcademyPortalLead, AcademyPortalQuery } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { academyPortalApi, academyPortalKey, academyPortalError } from './academy-api';
import { AcademyAccessAccount } from './ui/AcademyAccessAccount';
import { AcademyCredentialsDialog } from './ui/AcademyCredentialsDialog';
import { AcademyLeadRoleDialog } from './ui/AcademyLeadRoleDialog';

type CredentialTarget = {
  lead: AcademyPortalLead;
  account: AcademyPortalAccount;
  module: LearningModule;
  initial?: AcademyPortalCredentialResult;
};

export function AcademyPortalAccess() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const capabilities = useQuery(learningCapabilitiesQuery);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AcademyPortalQuery>({ q: '', page: 1, pageSize: 25 });
  const [leadRole, setLeadRole] = useState<AcademyPortalLead | null>(null);
  const [credentialTarget, setCredentialTarget] = useState<CredentialTarget | null>(null);
  const query = useQuery({
    queryKey: [...academyPortalKey, filters],
    queryFn: () => academyPortalApi.directory(filters),
    enabled: Boolean(capabilities.data?.portalEnabled && capabilities.data.canManageAccess),
    refetchInterval: state => state.state.data?.items.some(lead => lead.students.some(student => !student.account)) ? 5_000 : false,
  });

  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timeout = window.setTimeout(() => {
      setFilters(current => ({ ...current, q: search.trim(), page: 1 }));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search, filters.q]);

  useEffect(() => {
    if (!query.data) return;
    const lastPage = Math.max(1, Math.ceil(query.data.total / query.data.pageSize));
    if (filters.page > lastPage) setFilters(current => ({ ...current, page: lastPage }));
  }, [query.data, filters.page]);

  const clearSearch = () => {
    setSearch('');
    setFilters(current => ({ ...current, q: '', page: 1 }));
    searchRef.current?.focus();
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: academyPortalKey });
    void client.invalidateQueries({ queryKey: ['portal-directory'] });
    void client.invalidateQueries({ queryKey: ['portal-student-access'] });
  };
  const accountAction = (lead: AcademyPortalLead, account: AcademyPortalAccount, module: LearningModule) => (
    <AcademyAccessAccount account={account} onOpen={() => setCredentialTarget({ lead, account, module })} />
  );
  const columns: DataTableColumn<AcademyPortalLead>[] = [
    {
      key: 'lead', header: t('lead'), mobilePrimary: true, cellClassName: 'align-top md:w-1/4',
      render: lead => <div className="min-w-0 space-y-1 py-1">
        <p className="break-words font-medium">{lead.name}</p>
        <p className="break-words text-sm tabular-nums text-muted-foreground">{lead.phone}</p>
      </div>,
    },
    {
      key: 'lead-account', header: t('academyAccessLeadAccount'), cellClassName: 'align-top md:w-1/3',
      render: lead => <div className="space-y-3 py-1">
        {lead.role && <p className="text-sm font-medium">{t(lead.role === 'self' ? 'academyAccessRoleSelf' : 'academyAccessRoleRepresentative')}</p>}
        {lead.account ? accountAction(lead, lead.account, lead.role === 'representative' ? 'parent' : 'student') : (
          <Button type="button" variant="outline" size="sm" className="min-h-10 gap-2" onClick={() => setLeadRole(lead)}>
            <KeyRound className="size-4" aria-hidden="true" />{t('academyAccessIssue')}
          </Button>
        )}
        {lead.role === 'representative' && lead.account?.status === 'active' && (
          <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-2" onClick={() => setLeadRole(lead)}>
            <UserRoundPlus className="size-4" aria-hidden="true" />{t('academyAccessAddStudents')}
          </Button>
        )}
      </div>,
    },
    {
      key: 'students', header: t('students'), cellClassName: 'align-top',
      render: lead => <div className="divide-y divide-border/60">{lead.students.map(student => (
        <div key={student.id} className="space-y-2 py-3 first:pt-1 last:pb-1">
          <p className="break-words font-medium">{student.name}</p>
          {student.account ? accountAction(lead, student.account, 'student') : (
            <span className="text-sm text-muted-foreground" role="status">{t('academyAccessPreparing')}</span>
          )}
        </div>
      ))}</div>,
    },
  ];

  if (capabilities.isPending) return <p role="status">{t('loading')}</p>;
  if (capabilities.error) return <div role="alert" className="space-y-3">
    <p>{t('failedToLoadData')}</p>
    <Button variant="outline" onClick={() => void capabilities.refetch()}>{t('retry')}</Button>
  </div>;
  if (!capabilities.data?.portalEnabled || !capabilities.data.canManageAccess) return <p role="alert">{t('accessDeniedModule')}</p>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <form className="flex w-full min-w-0 gap-2 sm:max-w-xl sm:flex-1" role="search" onSubmit={event => {
        event.preventDefault();
        setFilters(current => ({ ...current, q: search.trim(), page: 1 }));
      }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input ref={searchRef} aria-label={t('academyAccessSearch')} placeholder={t('search')} className="pl-9 pr-11" maxLength={254}
            value={search} onChange={event => setSearch(event.target.value)} />
          {search && <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 size-10" aria-label={t('clearSearch')} onClick={clearSearch}>
            <X className="size-4" aria-hidden="true" />
          </Button>}
        </div>
        <Button type="submit">{t('search')}</Button>
      </form>
      <div className="flex items-center gap-3 sm:ml-auto">
        {query.data && <p className="text-sm tabular-nums text-muted-foreground" role="status">{t('navLeads')}: <span className="font-medium text-foreground">{query.data.total}</span></p>}
        <Button type="button" variant="outline" size="icon" aria-label={t('lmsStaffReload')} disabled={query.isFetching} onClick={refresh}>
          <RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
        </Button>
      </div>
    </div>
    {query.error ? <div role="alert" className="space-y-3 rounded-xl border p-6">
      <p>{t(academyPortalError(query.error))}</p>
      <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button>
    </div> : <div className="overflow-hidden rounded-xl border bg-card" aria-busy={query.isFetching}>
      <DataTable columns={columns} data={query.data?.items ?? []} keyExtractor={lead => String(lead.id)} pageSize={100} showPagination={false}
        isLoading={query.isPending} emptyState={<div className="space-y-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">{t(filters.q ? 'academyAccessSearchEmpty' : 'academyAccessEmpty')}</p>
          {filters.q && <Button type="button" variant="outline" onClick={clearSearch}>{t('clearSearch')}</Button>}
        </div>} />
      {query.data && <PaginationControls page={filters.page} pageSize={query.data.pageSize} totalItems={query.data.total} disabled={query.isFetching}
        onPageChange={page => setFilters(current => ({ ...current, page }))}
        onPageSizeChange={pageSize => setFilters(current => ({ ...current, page: 1, pageSize }))} />}
    </div>}
    {leadRole && <AcademyLeadRoleDialog lead={leadRole} onClose={() => setLeadRole(null)} onGranted={(result, module) => {
      setCredentialTarget({ lead: leadRole, account: result.account, module, initial: result });
      setLeadRole(null);
      refresh();
    }} />}
    {credentialTarget && <AcademyCredentialsDialog key={`${credentialTarget.account.id}:${credentialTarget.module}`} leadId={credentialTarget.lead.id}
      account={credentialTarget.account} module={credentialTarget.module} initial={credentialTarget.initial} onClose={() => setCredentialTarget(null)} onChanged={refresh} />}
  </div>;
}
