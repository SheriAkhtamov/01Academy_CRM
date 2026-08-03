import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheckBig, Clock3, ListChecks, RotateCcw, Settings2, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import {
  metaMarketingApi,
  metaMarketingQueryKeys,
  type MetaEventRow,
  type MetaEventsData,
} from '@/features/marketing/meta-api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { MetaIntegrationDialog } from './MetaIntegrationDialog';

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

export function MetaEventsSection() {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<MetaEventRow | null>(null);
  const queryKey = metaMarketingQueryKeys.events;
  const { data, isLoading, isError, error, refetch } = useQuery<MetaEventsData>({
    queryKey,
    queryFn: metaMarketingApi.events,
  });
  const retryEvent = useMutation({
    mutationFn: metaMarketingApi.retryEvent,
    onSuccess: async () => {
      toast({ title: t('metaRetryQueued') });
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (retryError: any) => toast({
      title: t('error'),
      description: retryError?.message === 'metaEventAlreadySent' ? t('metaEventAlreadySent') : retryError?.message,
      variant: 'destructive',
    }),
  });
  const dateTime = (value?: string | null) => value
    ? new Date(value).toLocaleString(locale)
    : t('noData');
  const statusLabel = (status: MetaEventRow['status']) => {
    if (status === 'sent') return t('messageDelivered');
    if (status === 'failed') return t('error');
    if (status === 'processing') return t('metaEventStatusProcessing');
    return t('metaEventStatusPending');
  };
  const statusVariant = (status: MetaEventRow['status']) => {
    if (status === 'sent') return 'success' as const;
    if (status === 'failed') return 'destructive' as const;
    if (status === 'processing') return 'purple' as const;
    return 'outline' as const;
  };
  const columns = [
    {
      key: 'event',
      header: t('metaEvent'),
      accessor: (row: MetaEventRow) => row.eventName,
      render: (row: MetaEventRow) => (
        <div>
          <p className="font-medium text-foreground">{row.eventName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.eventId}</p>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'lead',
      header: t('lead'),
      accessor: (row: MetaEventRow) => row.contactName || '',
      render: (row: MetaEventRow) => row.contactName || (row.leadId ? `#${row.leadId}` : t('noData')),
      sortable: true,
    },
    {
      key: 'creative',
      header: t('metaCreative'),
      accessor: (row: MetaEventRow) => row.hookName || row.adName || '',
      render: (row: MetaEventRow) => row.hookName || row.adName || row.adId || t('noData'),
      sortable: true,
    },
    { key: 'crmStage', header: t('metaCrmStage'), accessor: (row: MetaEventRow) => row.crmStage, sortable: true },
    {
      key: 'status',
      header: t('status'),
      accessor: (row: MetaEventRow) => statusLabel(row.status),
      render: (row: MetaEventRow) => <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
      sortable: true,
    },
    { key: 'attempts', header: t('metaAttempts'), accessor: (row: MetaEventRow) => row.attemptCount, sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'eventTime',
      header: t('metaEventTime'),
      accessor: (row: MetaEventRow) => new Date(row.eventTime).getTime(),
      render: (row: MetaEventRow) => dateTime(row.eventTime),
      sortable: true,
    },
  ];

  if (isLoading || !data) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('failedToLoadData')}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{error instanceof Error ? error.message : t('error')}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>{t('retry')}</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {!data.integration.capiConfigured ? (
        <Alert>
          <AlertTitle>{t('metaCapiNotConfigured')}</AlertTitle>
          <AlertDescription>{t('metaCapiNotConfiguredDesc')}</AlertDescription>
        </Alert>
      ) : null}
      <Alert>
        <AlertTitle>{t('metaConversionMapping')}</AlertTitle>
        <AlertDescription>{t('metaOptimizationNotice')}</AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <EventMetric label={t('metaEventsTotal')} value={data.summary.total} icon={ListChecks} />
        <EventMetric label={t('metaEventsPending')} value={data.summary.pending} icon={Clock3} />
        <EventMetric label={t('metaEventsSent')} value={data.summary.sent} icon={CircleCheckBig} />
        <EventMetric label={t('metaEventsFailed')} value={data.summary.failed} icon={TriangleAlert} />
        <EventMetric label={t('metaDeliveryRate')} value={`${data.summary.deliveryRate}%`} icon={CircleCheckBig} />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <CardTitle>{t('metaEventManager')}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="mr-2 size-4" />
            {t('metaConnection')}
          </Button>
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
                <p className="mt-1 text-sm text-muted-foreground">{t('metaNoEventsDesc')}</p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <MetaIntegrationDialog open={settingsOpen} onOpenChange={setSettingsOpen} integration={data.integration} />
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('metaEventDetails')}</DialogTitle>
            <DialogDescription>{selected?.eventName}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
              <EventDetail label={t('metaEventId')} value={selected.eventId} />
              <EventDetail label={t('status')} value={statusLabel(selected.status)} />
              <EventDetail label={t('metaCrmStage')} value={selected.crmStage} />
              <EventDetail label={t('metaAttempts')} value={String(selected.attemptCount)} />
              <EventDetail label={t('metaEventTime')} value={dateTime(selected.eventTime)} />
              <EventDetail label={t('metaLastAttempt')} value={dateTime(selected.lastAttemptAt)} />
              <EventDetail label={t('metaNextAttempt')} value={dateTime(selected.nextAttemptAt)} />
              <EventDetail label={t('metaSentAt')} value={dateTime(selected.sentAt)} />
              <EventDetail label={t('error')} value={selected.errorMessage} />
              <EventDetail label={t('metaResponse')} value={selected.responsePayload ? JSON.stringify(selected.responsePayload, null, 2) : null} />
            </div>
          ) : null}
          {selected && selected.status !== 'sent' ? (
            <DialogFooter>
              <Button onClick={() => retryEvent.mutate(selected.id)} disabled={retryEvent.isPending}>
                <RotateCcw className="mr-2 size-4" />
                {retryEvent.isPending ? t('loading') : t('retrySend')}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventDetail({ label, value }: { label: string; value?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-foreground">{value || t('noData')}</p>
    </div>
  );
}
