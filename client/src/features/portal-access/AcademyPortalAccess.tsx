import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcademyPortalAccount, AcademyPortalCredentialResult, AcademyPortalLead } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { academyPortalApi, academyPortalKey, academyPortalError } from './academy-api';
import { AcademyCredentialsDialog } from './ui/AcademyCredentialsDialog';
import { AcademyLeadRoleDialog } from './ui/AcademyLeadRoleDialog';

type CredentialTarget = { lead: AcademyPortalLead; account: AcademyPortalAccount; initial?: AcademyPortalCredentialResult };
export function AcademyPortalAccess() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const capabilities = useQuery(learningCapabilitiesQuery);
  const [search, setSearch] = useState('');
  const [q, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [leadRole, setLeadRole] = useState<AcademyPortalLead | null>(null);
  const [credentialTarget, setCredentialTarget] = useState<CredentialTarget | null>(null);
  const query = useQuery({
    queryKey: [...academyPortalKey, { q, page, pageSize }],
    queryFn: () => academyPortalApi.directory({ q, page, pageSize }),
    enabled: Boolean(capabilities.data?.portalEnabled && capabilities.data.canManageAccess),
    refetchInterval: state => state.state.data?.items.some(lead => lead.students.some(student => !student.account)) ? 5_000 : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: academyPortalKey });
    void client.invalidateQueries({ queryKey: ['portal-directory'] });
    void client.invalidateQueries({ queryKey: ['portal-student-access'] });
  };
  const accountAction = (lead: AcademyPortalLead, account: AcademyPortalAccount) => <div className="flex flex-wrap items-center gap-2">
    <span className="break-all font-mono text-sm">{account.login}</span>
    <Badge variant={account.status === 'active' ? 'default' : 'secondary'}>{t(account.status === 'active' ? 'academyAccessIssued' : 'academyAccessNotIssued')}</Badge>
    <Button type="button" variant="outline" size="sm" onClick={() => setCredentialTarget({ lead, account })}>{t(account.status === 'pending' ? 'academyAccessIssue' : 'academyAccessShowCredentials')}</Button>
  </div>;
  const columns: DataTableColumn<AcademyPortalLead>[] = [
    { key: 'lead', header: t('lead'), mobilePrimary: true, render: lead => <div className="space-y-1"><p className="font-medium">{lead.name}</p><p className="text-sm text-muted-foreground">{lead.phone}</p></div> },
    { key: 'lead-account', header: t('academyAccessLeadAccount'), render: lead => <div className="space-y-2">
      {lead.role && <p className="text-sm">{t(lead.role === 'self' ? 'academyAccessRoleSelf' : 'academyAccessRoleRepresentative')}</p>}
      {lead.account ? accountAction(lead, lead.account) : <Button type="button" variant="outline" size="sm" onClick={() => setLeadRole(lead)}>{t('academyAccessRoleChoose')}</Button>}
      {lead.role === 'representative' && <Button type="button" variant="ghost" size="sm" onClick={() => setLeadRole(lead)}>{t('academyAccessIssue')}</Button>}
    </div> },
    { key: 'students', header: t('students'), render: lead => <div className="space-y-4">{lead.students.map(student => <div key={student.id} className="space-y-2"><p className="font-medium">{student.name}</p>
      {student.account ? accountAction(lead, student.account) : <span className="text-sm text-muted-foreground" role="status">{t('academyAccessPreparing')}</span>}
    </div>)}</div> },
  ];
  if (capabilities.isPending) return <p role="status">{t('loading')}</p>;
  if (!capabilities.data?.portalEnabled || !capabilities.data.canManageAccess) return <p role="alert">{t('accessDeniedModule')}</p>;
  return <div className="space-y-5">
    <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
      <Input aria-label={t('academyAccessSearch')} placeholder={t('academyAccessSearch')} className="max-w-lg" value={search} onChange={event => setSearch(event.target.value)} />
      <Button type="submit">{t('search')}</Button>
    </form>
    {query.error ? <div role="alert" className="space-y-3"><p>{t(academyPortalError(query.error))}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <>
      <DataTable columns={columns} data={query.data?.items ?? []} keyExtractor={lead => String(lead.id)} pageSize={100} showPagination={false} isLoading={query.isPending} emptyState={<p className="p-8 text-center text-muted-foreground">{t('academyAccessEmpty')}</p>} />
      {query.data && query.data.total > query.data.pageSize && <PaginationControls page={page} pageSize={query.data.pageSize} totalItems={query.data.total} onPageChange={setPage} onPageSizeChange={size => { setPage(1); setPageSize(size); }} />}
    </>}
    {leadRole && <AcademyLeadRoleDialog lead={leadRole} onClose={() => setLeadRole(null)} onGranted={result => { setCredentialTarget({ lead: leadRole, account: result.account, initial: result }); setLeadRole(null); refresh(); }} />}
    {credentialTarget && <AcademyCredentialsDialog key={credentialTarget.account.id} leadId={credentialTarget.lead.id} account={credentialTarget.account} initial={credentialTarget.initial} onClose={() => setCredentialTarget(null)} onChanged={refresh} />}
  </div>;
}
