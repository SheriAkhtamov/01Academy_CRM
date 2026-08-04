import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeDollarSign,
  CircleCheckBig,
  Clapperboard,
  ExternalLink,
  Settings2,
  Target,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import {
  metaMarketingApi,
  metaMarketingQueryKeys,
  type MetaAttributionData,
  type MetaCreativeRow,
} from '@/features/marketing/meta-api';
import { useTranslation } from '@/hooks/useTranslation';
import { MetaIntegrationDialog } from './MetaIntegrationDialog';

function AttributionMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
}) {
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

export function MetaAttributionSection({ reportingQuery }: { reportingQuery: string }) {
  const { t, language } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<MetaCreativeRow | null>(null);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const { data, isLoading, isError, error, refetch } = useQuery<MetaAttributionData>({
    queryKey: [...metaMarketingQueryKeys.attribution, reportingQuery],
    queryFn: () => metaMarketingApi.attribution(reportingQuery),
    placeholderData: (previous) => previous,
  });
  const money = (value: number) => `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;
  const dateTime = (value?: string | null) => value
    ? new Date(value).toLocaleString(locale)
    : t('noData');
  const formatLabel = (value?: string | null) => {
    if (value === 'video') return t('mediaVideo');
    if (value === 'image') return t('creativeImage');
    if (value === 'carousel') return t('creativeCarousel');
    return t('creativeUnknown');
  };

  const columns = [
    {
      key: 'hook',
      header: t('metaAdPublication'),
      accessor: (row: MetaCreativeRow) => row.hookName || row.adName || '',
      render: (row: MetaCreativeRow) => (
        <div className="max-w-72">
          <p className="font-medium text-foreground">{row.hookName || t('metaHookUnknown')}</p>
          <p className="truncate text-xs text-muted-foreground">{row.adName || row.adId || t('noData')}</p>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'format',
      header: t('creativeFormat'),
      accessor: (row: MetaCreativeRow) => formatLabel(row.mediaType),
      render: (row: MetaCreativeRow) => <Badge variant="outline">{formatLabel(row.mediaType)}</Badge>,
      sortable: true,
    },
    { key: 'leads', header: t('metaAttributedLeads'), accessor: (row: MetaCreativeRow) => row.leads, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'qualified', header: t('qualifiedLeads'), accessor: (row: MetaCreativeRow) => row.qualified, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'demoInvited', header: t('invitedToDemo'), accessor: (row: MetaCreativeRow) => row.demoInvited, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paid', header: t('paidLeads'), accessor: (row: MetaCreativeRow) => row.paid, sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'qualificationRate',
      header: t('qualificationRate'),
      accessor: (row: MetaCreativeRow) => row.qualificationRate,
      render: (row: MetaCreativeRow) => `${row.qualificationRate}%`,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
    {
      key: 'paymentRate',
      header: t('paymentConversion'),
      accessor: (row: MetaCreativeRow) => row.paymentRate,
      render: (row: MetaCreativeRow) => `${row.paymentRate}%`,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
    {
      key: 'revenue',
      header: t('attributedRevenue'),
      accessor: (row: MetaCreativeRow) => row.revenue,
      render: (row: MetaCreativeRow) => money(row.revenue),
      sortable: true,
      cellClassName: 'tabular-nums font-medium',
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

  const summary = data.summary;
  return (
    <div className="space-y-4">
      {!data.integration.attributionConfigured ? (
        <Alert>
          <AlertTitle>{t('metaAttributionNotConfigured')}</AlertTitle>
          <AlertDescription>{t('metaAttributionNotConfiguredDesc')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <AttributionMetric label={t('metaCreatives')} value={summary.creatives} icon={Clapperboard} />
        <AttributionMetric label={t('metaAttributedLeads')} value={summary.leads} icon={Users} />
        <AttributionMetric label={t('qualifiedLeads')} value={summary.qualified} icon={UserRoundCheck} />
        <AttributionMetric label={t('invitedToDemo')} value={summary.demoInvited} icon={Target} />
        <AttributionMetric label={t('paidLeads')} value={summary.paid} icon={CircleCheckBig} />
        <AttributionMetric label={t('attributedRevenue')} value={money(summary.revenue)} icon={BadgeDollarSign} />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <CardTitle>{t('metaAttribution')}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="mr-2 size-4" />
            {t('metaConnection')}
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data.creatives}
            keyExtractor={(row) => row.attributionKey}
            defaultSortKey="leads"
            defaultSortDirection="desc"
            onRowClick={setSelected}
            emptyState={(
              <div className="py-14 text-center">
                <p className="font-medium text-foreground">{t('metaNoAttribution')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('metaNoAttributionDesc')}</p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <MetaIntegrationDialog open={settingsOpen} onOpenChange={setSettingsOpen} integration={data.integration} />
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.hookName || selected?.adName || t('metaDetails')}</DialogTitle>
            <DialogDescription>{t('metaDetails')}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
              <Detail label={t('metaAd')} value={[selected.adName, selected.adId].filter(Boolean).join(' · ')} />
              <Detail label={t('creativeFormat')} value={formatLabel(selected.mediaType)} />
              <Detail label={t('metaCampaign')} value={[selected.campaignName, selected.campaignId].filter(Boolean).join(' · ')} />
              <Detail label={t('metaAdSet')} value={[selected.adsetName, selected.adsetId].filter(Boolean).join(' · ')} />
              <Detail label={t('metaCreative')} value={[selected.creativeName, selected.creativeId].filter(Boolean).join(' · ')} />
              <Detail label={t('metaPublication')} value={selected.sourceUrl} href={selected.sourceUrl} />
              <Detail label={t('utmTags')} value={[
                selected.utmSource && `utm_source=${selected.utmSource}`,
                selected.utmMedium && `utm_medium=${selected.utmMedium}`,
                selected.utmCampaign && `utm_campaign=${selected.utmCampaign}`,
                selected.utmContent && `utm_content=${selected.utmContent}`,
                selected.utmTerm && `utm_term=${selected.utmTerm}`,
              ].filter(Boolean).join('\n')} />
              <Detail label={t('metaCapturedPeriod')} value={`${dateTime(selected.firstCapturedAt)} — ${dateTime(selected.lastCapturedAt)}`} />
              <Detail label={t('utmTags')} value={selected.utmDerived ? t('metaDerivedUtm') : t('metaDeclaredUtm')} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value, href }: { label: string; value?: string | null; href?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {href ? (
        <Button asChild variant="link" className="mt-1 h-auto justify-start p-0">
          <a href={href} target="_blank" rel="noreferrer noopener">
            {t('openMetaPublication')}
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{value || t('noData')}</p>
      )}
    </div>
  );
}
