import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheckBig, Clock3, ListChecks, RotateCcw, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { DataTable } from '@/components/ux/DataTable';
import {
  metaMarketingApi,
  metaMarketingQueryKeys,
  type MetaEventRow,
  type MetaEventsData,
} from '@/features/marketing/meta-api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';

function EventMetric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ListChecks }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

const accessUnavailable = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
};

export function MetaEventsSection({ reportingQuery }: { reportingQuery: string }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MetaEventRow | null>(null);
  const access = useRef({ key: reportingQuery, allowed: true, epoch: 0 });
  const [, renderAccess] = useState(0);
  if (access.current.key !== reportingQuery) access.current = { key: reportingQuery, allowed: access.current.allowed, epoch: access.current.epoch + 1 };
  const selectedRef = useRef(selected);
  const retryLocked = useRef(false);
  selectedRef.current = selected;
  const queryKey = [...metaMarketingQueryKeys.events, reportingQuery];
  const { data, isLoading, isError, error, refetch } = useQuery<MetaEventsData>({
    queryKey,
    queryFn: async () => {
      const epoch = access.current.epoch;
      try {
        const result = await metaMarketingApi.events(reportingQuery);
        if (access.current.key === reportingQuery && access.current.epoch === epoch) access.current.allowed = true;
        return result;
      } catch (readError) {
        if (accessUnavailable(readError) && access.current.key === reportingQuery && access.current.epoch === epoch) {
          access.current.allowed = false;
          access.current.epoch += 1;
        }
        throw readError;
      }
    },
    placeholderData: (previous) => access.current.allowed ? previous : undefined,
  });
  if (accessUnavailable(error) && access.current.allowed) {
    access.current.allowed = false;
    access.current.epoch += 1;
  }
  const unavailable = !access.current.allowed;
  useEffect(() => { if (unavailable) setSelected(null); }, [unavailable]);
  const retryRead = async () => {
    const key = access.current.key;
    const epoch = access.current.epoch;
    const result = await refetch();
    if (result.isSuccess && access.current.key === key && access.current.epoch === epoch) {
      access.current.allowed = true;
      renderAccess(value => value + 1);
    }
  };
  const retryEvent = useMutation({
    mutationFn: ({ eventId }: { eventId: number; epoch: number }) => metaMarketingApi.retryEvent(eventId),
    onSuccess: async (_result, { eventId, epoch }) => {
      if (!access.current.allowed || access.current.epoch !== epoch) return;
      toast({ title: t('metaRetryQueued') });
      if (selectedRef.current?.id === eventId) setSelected(null);
      await queryClient.invalidateQueries({ queryKey: metaMarketingQueryKeys.events });
    },
    onSettled: () => { retryLocked.current = false; },
    onError: (retryError: unknown, { epoch }) => {
      if (access.current.epoch !== epoch) return;
      if (accessUnavailable(retryError)) {
        access.current.allowed = false;
        access.current.epoch += 1;
        renderAccess(value => value + 1);
        return;
      }
      if (access.current.allowed) toast({
        title: t('error'),
        description: (retryError as Error)?.message === 'metaEventAlreadySent' ? t('metaEventAlreadySent') : t('metaDeliveryFailed'),
        variant: 'destructive',
      });
    },
  });
  const dateTime = (value?: string | null) => {
    if (!value) return t('noData');
    return formatAcademyDate(value, language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) || t('noData');
  };
  const statusLabel = (status: MetaEventRow['status']) => {
    if (status === 'sent') return t('messageDelivered');
    if (status === 'cancelled') return t('cancelled');
    if (status === 'failed') return t('error');
    if (status === 'processing') return t('metaEventStatusProcessing');
    return t('metaEventStatusPending');
  };
  const statusVariant = (status: MetaEventRow['status']) => {
    if (status === 'sent') return 'success' as const;
    if (status === 'cancelled') return 'secondary' as const;
    if (status === 'failed') return 'destructive' as const;
    if (status === 'processing') return 'purple' as const;
    return 'outline' as const;
  };
  const canRetry = (row: MetaEventRow) => row.crmStage == null && (row.status === 'failed' || row.status === 'pending');
  const eventLabel = (row: MetaEventRow) => row.eventName === 'Lead' ? t('newApplication') : row.eventName === 'Purchase' ? t('payment') : t('lead');
  const columns = [
    {
      key: 'event',
      header: t('metaEvent'),
      accessor: eventLabel,
      render: (row: MetaEventRow) => (
        <div>
          <p className="font-medium text-foreground">{eventLabel(row)}</p>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'lead',
      header: t('lead'),
      accessor: (row: MetaEventRow) => row.contactName || '',
      render: (row: MetaEventRow) => row.contactName || t('noData'),
      sortable: true,
    },
    {
      key: 'creative',
      header: t('metaCreative'),
      accessor: (row: MetaEventRow) => row.hookName || row.adName || '',
      render: (row: MetaEventRow) => row.hookName || row.adName || t('noData'),
      sortable: true,
    },
    {
      key: 'status',
      header: t('status'),
      accessor: (row: MetaEventRow) => statusLabel(row.status),
      render: (row: MetaEventRow) => <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
      sortable: true,
    },
    {
      key: 'eventTime',
      header: t('metaEventTime'),
      accessor: (row: MetaEventRow) => new Date(row.eventTime).getTime(),
      render: (row: MetaEventRow) => dateTime(row.eventTime),
      sortable: true,
    },
  ];

  if (unavailable || (isError && !data)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('failedToLoadData')}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{t('failedToLoadData')}</span>
          <Button variant="outline" size="sm" onClick={() => void retryRead()}>{t('retry')}</Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (isLoading || !data) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-tile gap-3">
        <EventMetric label={t('metaEventsTotal')} value={data.summary.total} icon={ListChecks} />
        <EventMetric label={t('metaEventsPending')} value={data.summary.pending} icon={Clock3} />
        <EventMetric label={t('metaEventsSent')} value={data.summary.sent} icon={CircleCheckBig} />
        <EventMetric label={t('metaEventsFailed')} value={data.summary.failed} icon={TriangleAlert} />
        <EventMetric label={t('metaDeliveryRate')} value={`${data.summary.deliveryRate}%`} icon={CircleCheckBig} />
      </div>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle>{t('metaEventManager')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data.events}
            keyExtractor={(row) => String(row.id)}
            defaultSortKey="eventTime"
            defaultSortDirection="desc"
            onRowClick={setSelected}
            rowClassName={(row) => row.status === 'failed' ? 'bg-destructive/5' : ''}
            emptyState={(
              <div className="py-14 text-center">
                <p className="font-medium text-foreground">{t('metaNoEvents')}</p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !retryEvent.isPending && !retryLocked.current) setSelected(null); }}>
        <DialogContent className="compact-modal flex max-h-[90dvh] max-w-xl flex-col overflow-hidden p-0" aria-describedby={undefined}>
          <DialogHeader className="compact-modal-header"><DialogTitle>{t('metaEventDetails')}</DialogTitle></DialogHeader>
          <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
            {selected ? <>
              <CompactModalSection key={`${selected.id}-status`} title={t('metaEvent')} icon={ListChecks} tone="sky" collapsible={false}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{eventLabel(selected)}</p>
                  <Badge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</Badge>
                </div>
                {selected.status === 'failed' ? <p role="alert" className="mt-2 text-sm text-destructive">{t('metaDeliveryFailed')}</p> : null}
              </CompactModalSection>
              <CompactModalSection key={`${selected.id}-time`} title={t('metaEventTime')} icon={Clock3} tone="teal" defaultOpen contentClassName="grid gap-2 sm:grid-cols-2">
                <EventDetail label={t('metaEventTime')} value={dateTime(selected.eventTime)} />
                <EventDetail label={t('metaSentAt')} value={dateTime(selected.sentAt)} />
              </CompactModalSection>
            </> : null}
          </div>
          <DialogFooter className="compact-modal-footer">
            <Button variant="outline" disabled={retryEvent.isPending} onClick={() => { if (!retryLocked.current) setSelected(null); }}>{t('cancel')}</Button>
            {selected && canRetry(selected) ? (
              <Button onClick={() => {
                if (!access.current.allowed || retryEvent.isPending || retryLocked.current) return;
                retryLocked.current = true;
                retryEvent.mutate({ eventId: selected.id, epoch: access.current.epoch });
              }} disabled={retryEvent.isPending}>
                <RotateCcw className="mr-2 size-4" />
                {retryEvent.isPending ? t('loading') : t('retrySend')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventDetail({ label, value }: { label: string; value?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{value || t('noData')}</p>
    </div>
  );
}
