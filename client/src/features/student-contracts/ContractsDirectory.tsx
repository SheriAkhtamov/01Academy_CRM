import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import type { StudentContractListQuery } from '@shared/contracts/student-contracts';
import type { StudentProfileStudent } from '@shared/contracts/student-profile';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { StudentDetailDialog } from '@/components/ux/StudentDetailDialog';
import { studentContractsApi } from './api';
import { LoadingRegion } from '@/components/ui/loading-region';

export function ContractsDirectory({ enabled = true }: { enabled?: boolean }) {
  const { user } = useAuth();
  return <ContractsDirectoryContent key={user?.id ?? 0} accountId={user?.id ?? 0} enabled={enabled && Boolean(user)} />;
}

function ContractsDirectoryContent({ accountId, enabled }: { accountId: number; enabled: boolean }) {
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<StudentContractListQuery>({ q: '', status: 'all', page: 1, pageSize: 25 });
  const [selected, setSelected] = useState<StudentProfileStudent | null>(null);
  const directory = useQuery({
    queryKey: ['student-contracts', accountId, query],
    queryFn: () => studentContractsApi.list(query),
    enabled,
    staleTime: 0,
  });
  const format = useMemo(() => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'short', timeZone: 'Asia/Tashkent',
  }), [language]);
  const dateTime = (value: string | null | undefined) => value ? format.format(new Date(value)) : t('noData');
  const updateQuery = (changes: Partial<StudentContractListQuery>) => setQuery(current => ({ ...current, ...changes }));
  const rows = directory.data?.items ?? [];

  return <section className="min-w-0 space-y-4" aria-label={t('studentContractsTitle')}>
    <form className="flex max-w-xl items-end gap-2" onSubmit={event => {
      event.preventDefault();
      updateQuery({ q: search.trim(), page: 1 });
    }}>
      <div className="min-w-0 flex-1 space-y-2">
        <Label htmlFor={searchId}>{t('studentContractsSearch')}</Label>
        <Input id={searchId} value={search} onChange={event => setSearch(event.target.value)} maxLength={120} className="min-h-11" />
      </div>
      <Button type="submit" variant="outline" className="min-h-11" aria-label={t('search')}><Search className="size-4" /></Button>
    </form>

    <Tabs value={query.status} onValueChange={status => updateQuery({ status: status as StudentContractListQuery['status'], page: 1 })}>
      <TabsList aria-label={t('studentContractsStatus')}>
        {(['all', 'created', 'missing'] as const).map(status => <TabsTrigger key={status} value={status} className="gap-2">
          {t(status === 'all' ? 'studentContractsAll' : status === 'created' ? 'studentContractsCreated' : 'studentContractsMissing')}
          {directory.data && <span aria-hidden="true" className="tabular-nums">{directory.data.counts[status]}</span>}
        </TabsTrigger>)}
      </TabsList>
      <TabsContent value={query.status}>
        {directory.isPending ? <LoadingRegion role="status" aria-label={t('loading')} className="space-y-3">
          <Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" />
        </LoadingRegion> : directory.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <p>{t('studentContractsLoadFailed')}</p><Button variant="outline" onClick={() => void directory.refetch()}>{t('retry')}</Button>
        </div> : rows.length === 0 ? <div className="rounded-lg border p-8 text-center text-sm">
          {query.q ? t('studentContractsNoResults') : query.status === 'missing' ? t('studentContractsMissingEmpty') : t('studentContractsEmpty')}
        </div> : <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b bg-muted/40"><tr>
                {(['studentContractNumber', 'student', 'group', 'phone', 'studentContractsCreatedAt', 'studentContractFile'] as const).map(key => (
                  <th key={key} scope="col" className="px-4 py-3 font-medium">{t(key)}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y">{rows.map(({ contract, student, groups }) => {
                const name = student.studentName || student.contactName;
                return <tr key={student.id} role="button" tabIndex={0} aria-haspopup="dialog"
                  aria-label={t('studentContractsOpenStudent').replace('{name}', name)}
                  className="cursor-pointer align-middle hover:bg-muted/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={event => {
                    if (event.target instanceof Element && event.target.closest('a')) return;
                    setSelected(student);
                  }}
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    setSelected(student);
                  }}>
                  <td className="max-w-64 break-words px-4 py-3 font-medium">{contract?.number ?? <span className="text-amber-700 dark:text-amber-400">{t('studentContractsNotCreated')}</span>}</td>
                  <td className="max-w-72 px-4 py-3">
                    <span className="font-medium">{name}</span>
                  </td>
                  <td className="max-w-64 break-words px-4 py-3">{groups.length ? <ul className="space-y-1">{groups.map(group => <li key={group.id}>{group.name}</li>)}</ul> : t('noData')}</td>
                  <td className="whitespace-nowrap px-4 py-3">{student.phone || t('noData')}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateTime(contract?.createdAt)}</td>
                  <td className="max-w-64 px-4 py-3">{contract?.file ? <a href={contract.file.downloadUrl} download
                    className="inline-flex min-h-11 items-center gap-2 break-all text-primary underline-offset-4 hover:underline">
                    <Download className="size-4 shrink-0" />{contract.file.name}
                  </a> : contract ? t('studentContractsNoFile') : t('noData')}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <PaginationControls page={directory.data?.page ?? query.page} pageSize={query.pageSize}
            totalItems={directory.data?.total ?? 0} disabled={directory.isFetching}
            onPageChange={page => updateQuery({ page })} onPageSizeChange={pageSize => updateQuery({ pageSize, page: 1 })} />
        </div>}
      </TabsContent>
    </Tabs>

    <StudentDetailDialog student={selected} open={enabled && Boolean(selected)} initialTab="contract" dateTime={dateTime}
      onOpenChange={open => {
        if (open) return;
        setSelected(null);
        void client.invalidateQueries({ queryKey: ['student-contracts', accountId] });
      }} />
  </section>;
}
