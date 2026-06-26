import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowRightLeft, UsersRound } from 'lucide-react';
import { LEAD_STATUSES } from '@shared/academy';

interface AdminLead {
  id: number;
  contactName: string;
  phone: string;
  studentName?: string | null;
  courseName?: string | null;
  sourceName?: string | null;
  statusCode: string;
  managerId?: number | null;
  managerName?: string | null;
  createdAt: string;
}

interface SalesManager {
  id: number;
  fullName: string;
}

const leadStatusTranslationKeys: Record<string, TranslationKey> = {
  new_request: 'leadStatusNewRequest',
  first_contact: 'leadStatusFirstContact',
  qualified: 'leadStatusQualified',
  demo_invited: 'leadStatusDemoInvited',
  demo_attended: 'leadStatusDemoAttended',
  offer: 'leadStatusOffer',
  thinking: 'leadStatusThinking',
  enrolled: 'leadStatusEnrolled',
  paid: 'leadStatusPaid',
  not_now: 'leadStatusNotNow',
};

export function LeadAssignmentContent() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [managerFilter, setManagerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(() => new Set());
  const [bulkManagerId, setBulkManagerId] = useState('');
  const [bulkConfirmationOpen, setBulkConfirmationOpen] = useState(false);

  const leadsQuery = useQuery<AdminLead[]>({ queryKey: ['/api/academy/leads'] });
  const usersQuery = useQuery<any[]>({ queryKey: ['/api/users'] });

  const managers = useMemo<SalesManager[]>(
    () => (usersQuery.data ?? [])
      .filter((employee) => employee.workspace === 'sales' && employee.isActive)
      .map((employee) => ({ id: employee.id, fullName: employee.fullName })),
    [usersQuery.data],
  );

  const filteredLeads = useMemo(
    () => (leadsQuery.data ?? []).filter((lead) => (
      (managerFilter === 'all' || String(lead.managerId ?? 'unassigned') === managerFilter)
      && (statusFilter === 'all' || lead.statusCode === statusFilter)
    )),
    [leadsQuery.data, managerFilter, statusFilter],
  );

  const managerLeadCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const lead of leadsQuery.data ?? []) {
      if (lead.managerId) counts.set(lead.managerId, (counts.get(lead.managerId) ?? 0) + 1);
    }
    return counts;
  }, [leadsQuery.data]);

  const selectedVisibleCount = filteredLeads.reduce(
    (count, lead) => count + (selectedLeadIds.has(lead.id) ? 1 : 0),
    0,
  );
  const allVisibleSelected = filteredLeads.length > 0 && selectedVisibleCount === filteredLeads.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const invalidateLeads = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/leads'] });

  const assignLead = useMutation({
    mutationFn: ({ leadId, managerId }: { leadId: number; managerId: number }) =>
      apiRequest('POST', `/api/academy/leads/${leadId}/assign`, { managerId }),
    onSuccess: () => {
      toast({ title: t('leadTransferred') });
      invalidateLeads();
    },
    onError: (error: Error) => {
      toast({ title: t('leadTransferFailed'), description: error.message, variant: 'destructive' });
      invalidateLeads();
    },
  });

  const bulkAssign = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/leads/bulk-assign', {
      leadIds: Array.from(selectedLeadIds),
      managerId: Number(bulkManagerId),
    }),
    onSuccess: (result: { updatedCount: number }) => {
      toast({
        title: t('leadsTransferred'),
        description: t('leadsTransferredCount').replace('{count}', String(result.updatedCount)),
      });
      setSelectedLeadIds(new Set());
      setBulkManagerId('');
      setBulkConfirmationOpen(false);
      invalidateLeads();
    },
    onError: (error: Error) => {
      toast({ title: t('leadTransferFailed'), description: error.message, variant: 'destructive' });
      setBulkConfirmationOpen(false);
    },
  });

  const statusName = (code: string) => {
    const key = leadStatusTranslationKeys[code];
    return key ? t(key) : code;
  };

  const toggleVisibleLeads = (checked: boolean) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      for (const lead of filteredLeads) {
        if (checked) next.add(lead.id);
        else next.delete(lead.id);
      }
      return next;
    });
  };

  const columns = useMemo<DataTableColumn<AdminLead>[]>(() => [
    {
      key: 'select',
      header: (
        <Checkbox
          checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
          onCheckedChange={(checked) => toggleVisibleLeads(checked === true)}
          aria-label={t('selectAll')}
        />
      ),
      render: (lead) => (
        <Checkbox
          checked={selectedLeadIds.has(lead.id)}
          onCheckedChange={(checked) => {
            setSelectedLeadIds((current) => {
              const next = new Set(current);
              if (checked === true) next.add(lead.id);
              else next.delete(lead.id);
              return next;
            });
          }}
          aria-label={`${t('selectLead')} ${lead.contactName}`}
        />
      ),
      cellClassName: 'w-12',
    },
    {
      key: 'lead',
      header: t('lead'),
      sortable: true,
      accessor: (lead) => `${lead.contactName} ${lead.studentName ?? ''} ${lead.phone}`,
      render: (lead) => (
        <div className="min-w-52">
          <p className="font-medium text-foreground">{lead.contactName}</p>
          <p className="text-sm text-muted-foreground">{lead.phone}</p>
          {lead.studentName ? <p className="text-xs text-muted-foreground">{lead.studentName}</p> : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (lead) => statusName(lead.statusCode),
      render: (lead) => (
        <Badge variant={lead.statusCode === 'paid' ? 'success' : 'secondary'}>
          {statusName(lead.statusCode)}
        </Badge>
      ),
    },
    {
      key: 'source',
      header: t('source'),
      sortable: true,
      accessor: (lead) => lead.sourceName ?? '',
      render: (lead) => (
        <div className="min-w-40">
          <p className="text-sm">{lead.sourceName || t('noData')}</p>
          {lead.courseName ? <p className="text-xs text-muted-foreground">{lead.courseName}</p> : null}
        </div>
      ),
    },
    {
      key: 'manager',
      header: t('responsibleManager'),
      sortable: true,
      accessor: (lead) => lead.managerName ?? '',
      render: (lead) => (
        <Select
          value={lead.managerId ? String(lead.managerId) : undefined}
          onValueChange={(value) => assignLead.mutate({ leadId: lead.id, managerId: Number(value) })}
          disabled={assignLead.isPending}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('selectManager')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {managers.map((manager) => (
                <SelectItem key={manager.id} value={String(manager.id)}>
                  {manager.fullName} · {managerLeadCounts.get(manager.id) ?? 0}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: 'createdAt',
      header: t('created'),
      sortable: true,
      accessor: (lead) => new Date(lead.createdAt).getTime(),
      render: (lead) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(lead.createdAt).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
  ], [
    allVisibleSelected,
    assignLead,
    managerLeadCounts,
    managers,
    selectedLeadIds,
    someVisibleSelected,
    t,
  ]);

  if (leadsQuery.isError || usersQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{t('failedToLoadData')}</AlertTitle>
        <AlertDescription>{t('retry')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t('leadFilters')}</CardTitle>
            <CardDescription>{t('leadAssignmentSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allManagers')}</SelectItem>
                  <SelectItem value="unassigned">{t('notAssigned')}</SelectItem>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={String(manager.id)}>
                      {manager.fullName} · {managerLeadCounts.get(manager.id) ?? 0}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status.code} value={status.code}>{statusName(status.code)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedLeadIds.size > 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t('selectedLeadsCount').replace('{count}', String(selectedLeadIds.size))}</p>
                <p className="text-sm text-muted-foreground">{t('bulkAssignmentHint')}</p>
              </div>
              <Select value={bulkManagerId} onValueChange={setBulkManagerId}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue placeholder={t('selectManager')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {managers.map((manager) => (
                      <SelectItem key={manager.id} value={String(manager.id)}>{manager.fullName}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                onClick={() => setBulkConfirmationOpen(true)}
                disabled={!bulkManagerId || bulkAssign.isPending}
              >
                <ArrowRightLeft data-icon="inline-start" />
                {t('assignSelected')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-0">
            {leadsQuery.isLoading || usersQuery.isLoading ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={filteredLeads}
                keyExtractor={(lead) => `lead-${lead.id}`}
                defaultSortKey="createdAt"
                defaultSortDirection="desc"
                emptyState={
                  <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                    <UsersRound className="text-muted-foreground" />
                    <h3 className="font-medium">{t('noLeadsFound')}</h3>
                    <p className="text-sm text-muted-foreground">{t('adjustFilters')}</p>
                  </div>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={bulkConfirmationOpen} onOpenChange={setBulkConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmBulkAssignment')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmBulkAssignmentDescription')
                .replace('{count}', String(selectedLeadIds.size))
                .replace(
                  '{manager}',
                  managers.find((manager) => String(manager.id) === bulkManagerId)?.fullName ?? '',
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAssign.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkAssign.isPending}
              onClick={(event) => {
                event.preventDefault();
                bulkAssign.mutate();
              }}
            >
              {bulkAssign.isPending ? t('saving') : t('assignSelected')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminLeadsPage() {
  const { t } = useTranslation();

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('salesSettings')}
        subtitle={t('salesSettingsDescription')}
        breadcrumbs={[{ label: t('administration'), href: '/admin' }, { label: t('salesSettings') }]}
      />
      <LeadAssignmentContent />
    </div>
  );
}
