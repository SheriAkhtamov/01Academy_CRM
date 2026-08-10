import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeDollarSign,
  CircleCheckBig,
  Clapperboard,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Newspaper,
  Play,
  RefreshCw,
  Settings2,
  Target,
  Wallet,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import {
  metaMarketingApi,
  metaMarketingQueryKeys,
  type MetaAttributionData,
  type MetaAttributionLeadsData,
  type MetaAttributionLeadRow,
  type MetaCreativeRow,
  type MetaFormRow,
} from '@/features/marketing/meta-api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';

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

const mediaTypeIcon = (mediaType?: string | null) => {
  if (mediaType === 'video') return Play;
  if (mediaType === 'image') return ImageIcon;
  if (mediaType === 'carousel') return Layers;
  if (mediaType === 'share') return Newspaper;
  return Clapperboard;
};

/**
 * Meta serves creative thumbnails from its own CDN with signed URLs that can expire,
 * so a broken image falls back to the format icon instead of a torn placeholder.
 */
function CreativeThumbnail({ row, label }: { row: MetaCreativeRow; label: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const Icon = mediaTypeIcon(row.mediaType);
  const showImage = Boolean(row.thumbnailUrl) && !failed;

  return (
    <div
      className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted"
      title={label}
    >
      {showImage ? (
        <img
          src={row.thumbnailUrl as string}
          alt={`${t('metaCreativePreview')} — ${label}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <span className="absolute bottom-0.5 right-0.5 flex size-4 items-center justify-center rounded bg-background/85 text-foreground shadow-sm">
        <Icon className="size-2.5" />
      </span>
    </div>
  );
}

export function MetaAttributionSection({ reportingQuery }: { reportingQuery: string }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MetaCreativeRow | null>(null);
  const [selectedLeadsCreative, setSelectedLeadsCreative] = useState<MetaCreativeRow | null>(null);
  const [onlyWithLeads, setOnlyWithLeads] = useState(false);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const queryKey = [...metaMarketingQueryKeys.attribution, reportingQuery];
  const { data, isLoading, isError, error, refetch } = useQuery<MetaAttributionData>({
    queryKey,
    queryFn: () => metaMarketingApi.attribution(reportingQuery),
    placeholderData: (previous) => previous,
  });
  const attributedLeads = useQuery<MetaAttributionLeadsData>({
    queryKey: [
      ...metaMarketingQueryKeys.attributionLeads,
      reportingQuery,
      selectedLeadsCreative?.attributionKey,
    ],
    queryFn: () => metaMarketingApi.attributionLeads(
      reportingQuery,
      selectedLeadsCreative!.attributionKey,
    ),
    enabled: Boolean(selectedLeadsCreative),
  });
  const syncCatalog = useMutation({
    mutationFn: metaMarketingApi.syncCatalog,
    onSuccess: async () => {
      toast({ title: t('metaCatalogSynced') });
      await queryClient.invalidateQueries({ queryKey: metaMarketingQueryKeys.attribution });
    },
    onError: (syncError: any) => toast({
      title: t('error'),
      description: syncError?.message === 'metaAttributionNotConfigured'
        ? t('metaAttributionNotConfiguredDesc')
        : syncError?.message,
      variant: 'destructive',
    }),
  });
  const visibleCreatives = useMemo(
    () => (onlyWithLeads ? (data?.creatives ?? []).filter((row) => row.leads > 0) : data?.creatives ?? []),
    [data?.creatives, onlyWithLeads],
  );
  const statusLabel = (status?: string | null) => {
    const normalized = (status ?? '').toUpperCase();
    if (normalized === 'ACTIVE') return t('metaAdStatusActive');
    if (normalized.includes('ARCHIVED') || normalized === 'DELETED') return t('leadInArchive');
    if (!normalized) return null;
    return t('metaAdStatusPaused');
  };
  const money = (value: number) => `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;
  // Ad spend arrives already converted when a USD→UZS rate is configured; otherwise it
  // stays in the account currency so nothing is silently mislabelled as soum.
  const spendMoney = (value?: number | null) => {
    if (value === null || value === undefined) return t('noData');
    return data?.spendCurrency === 'USD'
      ? `$${Number(value).toLocaleString(locale, { maximumFractionDigits: 2 })}`
      : money(value);
  };
  const dateTime = (value?: string | null) => value
    ? new Date(value).toLocaleString(locale)
    : t('noData');
  const formatLabel = (value?: string | null) => {
    if (value === 'video') return t('mediaVideo');
    if (value === 'image') return t('creativeImage');
    if (value === 'carousel') return t('creativeCarousel');
    if (value === 'share') return t('creativeShare');
    return t('creativeUnknown');
  };

  const columns = [
    {
      key: 'hook',
      header: t('metaAdPublication'),
      // Meta names the ad, so an unnamed hook shows the real ad name rather than a placeholder.
      accessor: (row: MetaCreativeRow) => row.hookName || row.adName || row.adId || '',
      render: (row: MetaCreativeRow) => {
        const title = row.hookName || row.adName || row.adId || t('noData');
        const status = statusLabel(row.effectiveStatus);
        return (
          <div className={`flex max-w-96 items-center gap-3 ${row.leads > 0 ? '' : 'opacity-70'}`}>
            <CreativeThumbnail row={row} label={formatLabel(row.mediaType)} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground" title={title}>{title}</p>
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs text-muted-foreground" title={row.campaignName ?? undefined}>
                  {row.campaignName || row.adName || t('noData')}
                </p>
                {status ? (
                  <Badge
                    variant={row.effectiveStatus?.toUpperCase() === 'ACTIVE' ? 'success' : 'outline'}
                    className="shrink-0 px-1.5 py-0 text-[10px]"
                  >
                    {status}
                  </Badge>
                ) : null}
                {row.inCatalog === false ? (
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]" title={t('metaAdMissingFromCatalog')}>
                    {t('metaAdMissingFromCatalog')}
                  </Badge>
                ) : null}
              </div>
            </div>
            {row.sourceUrl ? (
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => event.stopPropagation()}
                aria-label={t('openMetaPublication')}
                title={t('openMetaPublication')}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </div>
        );
      },
      sortable: true,
    },
    {
      key: 'spend',
      header: t('metaAdSpend'),
      accessor: (row: MetaCreativeRow) => row.spend,
      render: (row: MetaCreativeRow) => spendMoney(row.spend),
      sortable: true,
      cellClassName: 'tabular-nums',
    },
    {
      key: 'costPerLead',
      header: t('metaCostPerLead'),
      // Ads with spend but no leads sort as the worst rather than the best.
      accessor: (row: MetaCreativeRow) => (row.costPerLead ?? (row.spend > 0 ? Number.MAX_SAFE_INTEGER : -1)),
      render: (row: MetaCreativeRow) => (
        row.costPerLead === null
          ? <span className="text-muted-foreground">{row.spend > 0 ? t('metaSpendNoLeads') : t('noData')}</span>
          : spendMoney(row.costPerLead)
      ),
      sortable: true,
      cellClassName: 'tabular-nums font-medium',
    },
    {
      key: 'leads',
      header: t('metaAttributedLeads'),
      accessor: (row: MetaCreativeRow) => row.leads,
      render: (row: MetaCreativeRow) => row.leads > 0 ? (
        <button
          type="button"
          className="inline-flex min-w-8 items-center justify-center rounded-md px-2 py-1 font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:bg-primary/10 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedLeadsCreative(row);
          }}
          aria-label={`${t('metaViewAttributedLeads')}: ${row.leads}`}
          title={t('metaViewAttributedLeads')}
        >
          {row.leads}
        </button>
      ) : <span className="px-2 text-muted-foreground">0</span>,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
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

  const formColumns = [
    {
      key: 'form',
      header: t('metaFormName'),
      accessor: (row: MetaFormRow) => row.formName || row.formId,
      render: (row: MetaFormRow) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.formName || t('metaFormUnknown')}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.formId}</p>
        </div>
      ),
      sortable: true,
    },
    { key: 'leads', header: t('metaAttributedLeads'), accessor: (row: MetaFormRow) => row.leads, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'qualified', header: t('qualifiedLeads'), accessor: (row: MetaFormRow) => row.qualified, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'demoInvited', header: t('invitedToDemo'), accessor: (row: MetaFormRow) => row.demoInvited, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paid', header: t('paidLeads'), accessor: (row: MetaFormRow) => row.paid, sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'revenue',
      header: t('attributedRevenue'),
      accessor: (row: MetaFormRow) => row.revenue,
      render: (row: MetaFormRow) => money(row.revenue),
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
        <AttributionMetric
          label={t('metaAdsWithLeads')}
          value={`${summary.creatives} / ${summary.totalAds}`}
          icon={Clapperboard}
        />
        <AttributionMetric label={t('metaAdSpend')} value={spendMoney(summary.spend)} icon={Wallet} />
        <AttributionMetric label={t('metaAttributedLeads')} value={summary.leads} icon={Users} />
        <AttributionMetric label={t('qualifiedLeads')} value={summary.qualified} icon={UserRoundCheck} />
        <AttributionMetric label={t('invitedToDemo')} value={summary.demoInvited} icon={Target} />
        <AttributionMetric label={t('paidLeads')} value={summary.paid} icon={CircleCheckBig} />
        <AttributionMetric label={t('attributedRevenue')} value={money(summary.revenue)} icon={BadgeDollarSign} />
      </div>
      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t('metaAttribution')}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={onlyWithLeads ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOnlyWithLeads((previous) => !previous)}
            >
              {onlyWithLeads ? t('metaShowAllAds') : t('metaOnlyWithLeads')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncCatalog.mutate()}
              disabled={syncCatalog.isPending}
            >
              <RefreshCw className={`mr-2 size-4 ${syncCatalog.isPending ? 'animate-spin' : ''}`} />
              {t('metaRefreshCatalog')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={visibleCreatives}
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

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>{t('metaFormsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={formColumns}
            data={data.forms ?? []}
            keyExtractor={(row) => row.formId}
            defaultSortKey="leads"
            defaultSortDirection="desc"
            emptyState={(
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">{t('metaNoAttribution')}</p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.hookName || selected?.adName || t('metaDetails')}</DialogTitle>
            <DialogDescription>{t('metaDetails')}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-muted/20 p-3">
              <CreativeThumbnail row={selected} label={formatLabel(selected.mediaType)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{selected.adName || selected.adId || t('noData')}</p>
                <p className="truncate text-xs text-muted-foreground">{selected.campaignName || t('noData')}</p>
              </div>
              <Badge variant="outline" className="shrink-0">{formatLabel(selected.mediaType)}</Badge>
            </div>
          ) : null}
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

      <Dialog
        open={Boolean(selectedLeadsCreative)}
        onOpenChange={(open) => !open && setSelectedLeadsCreative(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-6 pb-4 pt-6 pr-12">
            <DialogTitle>{t('metaAttributedLeads')}</DialogTitle>
            <DialogDescription>
              {t('metaAttributedLeadsDescription')}
              {selectedLeadsCreative ? ` ${selectedLeadsCreative.hookName || selectedLeadsCreative.adName || selectedLeadsCreative.adId || ''}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 pb-6">
            {attributedLeads.isLoading ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : attributedLeads.isError ? (
              <Alert variant="destructive" className="my-2">
                <AlertTitle>{t('failedToLoadData')}</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>{attributedLeads.error instanceof Error ? attributedLeads.error.message : t('error')}</span>
                  <Button variant="outline" size="sm" onClick={() => attributedLeads.refetch()}>{t('retry')}</Button>
                </AlertDescription>
              </Alert>
            ) : attributedLeads.data?.leads.length ? (
              <div className="divide-y divide-border/60">
                {attributedLeads.data.leads.map((lead) => (
                  <AttributedLeadRow key={lead.id} lead={lead} dateTime={dateTime} />
                ))}
              </div>
            ) : (
              <div className="py-14 text-center">
                <Users className="mx-auto size-8 text-muted-foreground/60" />
                <p className="mt-3 text-sm font-medium text-foreground">{t('metaNoAttributedLeads')}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttributedLeadRow({
  lead,
  dateTime,
}: {
  lead: MetaAttributionLeadRow;
  dateTime: (value?: string | null) => string;
}) {
  const { t } = useTranslation();
  const name = lead.contactName || lead.studentName || `#${lead.id}`;
  const href = `${lead.isArchived ? '/sales/archive' : '/sales/pipeline'}?lead=${lead.id}`;

  return (
    <a
      href={href}
      className="group flex items-center gap-3 py-4 outline-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/50"
      title={t('openLead')}
    >
      <Avatar className="size-10 border border-border/60">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{name}</p>
          {lead.isArchived ? <Badge variant="outline">{t('leadInArchive')}</Badge> : null}
          {lead.statusName || lead.statusCode ? (
            <Badge variant="secondary" className="gap-1.5">
              {lead.statusColor ? (
                <span className="size-2 rounded-full" style={{ backgroundColor: lead.statusColor }} />
              ) : null}
              {lead.statusName || lead.statusCode}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{lead.phone || t('noData')}</span>
          <span>{t('manager')}: {lead.managerName || t('notAssigned')}</span>
          <span>{t('metaLeadReceivedAt')}: {dateTime(lead.capturedAt)}</span>
        </div>
      </div>
      <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </a>
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
