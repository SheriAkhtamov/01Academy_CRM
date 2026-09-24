import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Shuffle, UsersRound } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { leadQueryKeys } from '@/features/leads/api';
import { salesQueryKeys } from '@/features/sales/queries';
import { leadDistributionApi, leadDistributionQueryKey } from './api';

export function LeadDistributionPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const settings = useQuery({
    queryKey: leadDistributionQueryKey,
    queryFn: leadDistributionApi.get,
  });
  const update = useMutation({
    mutationFn: leadDistributionApi.update,
    onSuccess: async (result) => {
      queryClient.setQueryData(leadDistributionQueryKey, result);
      setPendingEnabled(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: salesQueryKeys.module }),
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.unviewedCount }),
      ]);
      toast({
        title: result.enabled
          ? t('autoLeadDistributionEnabledToast')
          : t('autoLeadDistributionDisabledToast'),
        ...(result.distributedLeadCount
          ? {
            description: t('autoLeadDistributionAssignedCount')
              .replace('{count}', String(result.distributedLeadCount)),
          }
          : {}),
      });
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  if (settings.isLoading) {
    return <Skeleton className="h-52 w-full" />;
  }

  if (settings.isError || !settings.data) {
    return (
      <Card>
        <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{t('failedToLoadData')}</p>
          <Button variant="outline" onClick={() => settings.refetch()}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }

  const data = settings.data;
  const cannotEnable = !data.defaultFunnelId || data.eligibleManagers.length === 0;
  const switchDescriptionId = 'auto-lead-distribution-description';

  return (
    <AlertDialog
      open={pendingEnabled !== null}
      onOpenChange={(open) => {
        if (!open && !update.isPending) setPendingEnabled(null);
      }}
    >
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Shuffle className="size-5 text-primary" />
            <CardTitle>{t('autoLeadDistribution')}</CardTitle>
            <Badge variant={data.enabled ? 'success' : 'outline'}>
              {data.enabled
                ? t('autoLeadDistributionEnabled')
                : t('autoLeadDistributionDisabled')}
            </Badge>
          </div>
          <CardDescription id={switchDescriptionId}>
            {t('autoLeadDistributionDescription')}
          </CardDescription>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          <Label htmlFor="auto-lead-distribution" className="cursor-pointer">
            {data.enabled
              ? t('autoLeadDistributionEnabled')
              : t('autoLeadDistributionDisabled')}
          </Label>
          <Switch
            id="auto-lead-distribution"
            checked={data.enabled}
            disabled={update.isPending || (!data.enabled && cannotEnable)}
            aria-describedby={switchDescriptionId}
            onCheckedChange={setPendingEnabled}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cannotEnable ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('autoLeadDistributionUnavailable')}</AlertTitle>
            <AlertDescription>
              {t(data.defaultFunnelId
                ? 'autoLeadDistributionNoManagers'
                : 'autoLeadDistributionDefaultFunnelRequired')}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <UsersRound className="size-4 text-muted-foreground" />
              {t('autoLeadDistributionManagers')}
              <Badge variant="secondary">{data.eligibleManagers.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.eligibleManagers.length > 0
                ? data.eligibleManagers.map((manager) => (
                  <Badge key={manager.id} variant="outline">{manager.fullName}</Badge>
                ))
                : <span className="text-sm text-muted-foreground">{t('autoLeadDistributionManagerListEmpty')}</span>}
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">{t('autoLeadDistributionCurrentQueue')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data.unassignedNewLeadCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('autoLeadDistributionCurrentQueueDescription')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingEnabled
              ? t('autoLeadDistributionEnableConfirmTitle')
              : t('autoLeadDistributionDisableConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingEnabled
              ? t('autoLeadDistributionEnableConfirmDescription').replace('{count}', String(data.unassignedNewLeadCount))
              : t('autoLeadDistributionDisableConfirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={update.isPending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={update.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (pendingEnabled !== null) update.mutate(pendingEnabled);
            }}
          >
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pendingEnabled
              ? t('autoLeadDistributionEnableAction')
              : t('autoLeadDistributionDisableAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
