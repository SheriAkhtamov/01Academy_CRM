import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Edit3,
  GitBranch,
  Globe2,
  Loader2,
  PhoneCall,
  Plus,
  RadioTower,
  Trash2,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { salesFunnelsApi, type SalesFunnel } from './api';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';

type FunnelDraft = {
  name: string;
  isActive: boolean;
  isDefault: boolean;
};

const EMPTY_DRAFT: FunnelDraft = { name: '', isActive: true, isDefault: false };

const LEAD_SOURCE_PROVIDERS = [
  { provider: 'website', Icon: Globe2 },
  { provider: 'instagram', Icon: Camera },
  { provider: 'meta', Icon: RadioTower },
  { provider: 'onlinepbx', Icon: PhoneCall },
] as const;

const integrationKey = (provider: string) => {
  switch (provider) {
    case 'website': return 'integrationProviderWebsite' as const;
    case 'instagram': return 'instagramIntegration' as const;
    case 'meta': return 'metaIntegration' as const;
    case 'onlinepbx': return 'onlinePbxIntegration' as const;
    default: return 'navIntegrations' as const;
  }
};

export function SalesFunnelsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SalesFunnel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<FunnelDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<SalesFunnel | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');

  const funnels = useQuery<SalesFunnel[]>({ queryKey: ['/api/academy/sales-funnels'] });
  const activeFunnels = useMemo(
    () => (funnels.data ?? []).filter((funnel) => funnel.isActive),
    [funnels.data],
  );
  const funnelByProvider = useMemo(() => {
    const assignments = new Map<string, SalesFunnel>();
    for (const funnel of funnels.data ?? []) {
      for (const provider of funnel.integrations) assignments.set(provider, funnel);
    }
    return assignments;
  }, [funnels.data]);
  const activeTransferTargets = useMemo(
    () => activeFunnels.filter((funnel) => funnel.id !== deleteTarget?.id),
    [activeFunnels, deleteTarget?.id],
  );
  const deleteNeedsTransfer = Boolean(
    deleteTarget
    && (deleteTarget.isDefault || deleteTarget.leadCount > 0 || deleteTarget.integrationCount > 0),
  );

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['/api/academy/sales-funnels'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/configuration'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] }),
  ]);

  const closeEditor = () => {
    setDialogOpen(false);
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  const openEditor = (funnel?: SalesFunnel) => {
    setEditing(funnel ?? null);
    setDraft(funnel
      ? { name: funnel.name, isActive: funnel.isActive, isDefault: funnel.isDefault }
      : EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const saveFunnel = useMutation({
    mutationFn: () => {
      const name = draft.name.trim();
      if (!name) throw new Error(t('salesFunnelNameRequired'));
      return editing
        ? salesFunnelsApi.update(editing.id, { ...draft, name })
        : salesFunnelsApi.create({ ...draft, name });
    },
    onSuccess: async () => {
      toast({ title: editing ? t('salesFunnelUpdated') : t('salesFunnelCreated') });
      closeEditor();
      await invalidate();
    },
    onError: (error: Error & { rawMessage?: string }) => {
      const code = error.rawMessage;
      const description = code === 'salesFunnelNameExists'
        ? t('salesFunnelNameExists')
        : code === 'salesFunnelDefaultMustRemainActive'
          ? t('salesFunnelDefaultMustRemainActive')
          : code === 'salesFunnelInUseMustRemainActive'
            ? t('salesFunnelInUseMustRemainActive')
          : error.message;
      toast({ title: t('error'), description, variant: 'destructive' });
    },
  });

  const deleteFunnel = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return;
      if (deleteNeedsTransfer) {
        if (!transferTargetId) throw new Error(t('salesFunnelTransferTargetRequired'));
        await salesFunnelsApi.transferAndDelete(deleteTarget.id, Number(transferTargetId));
        return;
      }
      await salesFunnelsApi.delete(deleteTarget.id);
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      setTransferTargetId('');
      toast({ title: t('salesFunnelDeleted') });
      await invalidate();
    },
    onError: (error: Error & { rawMessage?: string }) => {
      const description = error.rawMessage === 'salesFunnelTransferRequired'
        ? t('salesFunnelTransferRequired')
        : error.rawMessage === 'salesFunnelTransferTargetRequired'
          ? t('salesFunnelTransferTargetRequired')
          : error.message;
      toast({ title: t('error'), description, variant: 'destructive' });
    },
  });

  const updateIntegrationFunnel = useMutation({
    mutationFn: ({ provider, funnelId }: { provider: string; funnelId: number }) =>
      salesFunnelsApi.assignIntegration(provider, funnelId),
    onSuccess: async () => {
      await invalidate();
      toast({ title: t('integrationFunnelUpdated') });
    },
    onError: (error: Error) => {
      toast({
        title: t('integrationFunnelUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const columns = useMemo<DataTableColumn<SalesFunnel>[]>(() => [
    {
      key: 'name',
      header: t('salesFunnelName'),
      accessor: (funnel) => funnel.name,
      sortable: true,
      mobilePrimary: true,
      render: (funnel) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{funnel.name}</span>
          {funnel.isDefault ? <Badge variant="secondary">{t('salesFunnelDefault')}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'leadCount',
      header: t('navLeads'),
      accessor: (funnel) => Number(funnel.leadCount),
      sortable: true,
      render: (funnel) => Number(funnel.leadCount).toLocaleString(),
    },
    {
      key: 'integrations',
      header: t('funnelIntegrations'),
      accessor: (funnel) => Number(funnel.integrationCount),
      render: (funnel) => (
        <div className="flex flex-wrap gap-1.5">
          {funnel.integrations.length > 0
            ? funnel.integrations.map((provider) => (
              <Badge key={provider} variant="outline">{t(integrationKey(provider))}</Badge>
            ))
            : <span className="text-muted-foreground">{t('noFunnelIntegrations')}</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      accessor: (funnel) => Number(funnel.isActive),
      render: (funnel) => (
        <Badge variant={funnel.isActive ? 'success' : 'secondary'}>
          {funnel.isActive ? t('active') : t('inactive')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      mobileLabel: t('actions'),
      render: (funnel) => (
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={() => openEditor(funnel)}>
            <Edit3 />
            <span className="sr-only">{t('edit')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              const firstTarget = (funnels.data ?? []).find((candidate) => candidate.isActive && candidate.id !== funnel.id);
              setDeleteTarget(funnel);
              setTransferTargetId(firstTarget ? String(firstTarget.id) : '');
            }}
          >
            <Trash2 />
            <span className="sr-only">{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ], [funnels.data, t]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t('salesFunnels')}</CardTitle>
            <CardDescription>{t('salesFunnelsDescription')}</CardDescription>
          </div>
          <Button type="button" onClick={() => openEditor()}>
            <Plus data-icon="inline-start" />{t('addSalesFunnel')}
          </Button>
        </CardHeader>
        <CardContent>
          {funnels.isError ? (
            <EmptyState
              icon={GitBranch}
              title={t('failedToLoadData')}
              description={t('failedToLoadDataHint')}
              action={(
                <Button type="button" variant="outline" onClick={() => funnels.refetch()}>
                  {t('retry')}
                </Button>
              )}
            />
          ) : (
            <DataTable
              columns={columns}
              data={funnels.data ?? []}
              keyExtractor={(funnel) => String(funnel.id)}
              isLoading={funnels.isLoading}
              defaultSortKey="name"
              emptyState={(
                <EmptyState
                  icon={GitBranch}
                  title={t('noSalesFunnels')}
                  description={t('noSalesFunnelsDescription')}
                  action={(
                    <Button type="button" onClick={() => openEditor()}>
                      <Plus data-icon="inline-start" />{t('addSalesFunnel')}
                    </Button>
                  )}
                />
              )}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('funnelIntegrations')}</CardTitle>
          <CardDescription>{t('leadSourceDistributionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {LEAD_SOURCE_PROVIDERS.map(({ provider, Icon }) => {
            const assignedFunnel = funnelByProvider.get(provider);

            return (
              <div key={provider} className="space-y-2 rounded-xl border border-border p-4">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <Label htmlFor={`lead-source-funnel-${provider}`}>{t(integrationKey(provider))}</Label>
                </div>
                <Select
                  value={assignedFunnel ? String(assignedFunnel.id) : ''}
                  onValueChange={(value) => updateIntegrationFunnel.mutate({
                    provider,
                    funnelId: Number(value),
                  })}
                  disabled={
                    funnels.isLoading
                    || updateIntegrationFunnel.isPending
                    || activeFunnels.length === 0
                  }
                >
                  <SelectTrigger id={`lead-source-funnel-${provider}`}>
                    <SelectValue placeholder={t('selectSalesFunnel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeFunnels.map((funnel) => (
                      <SelectItem key={funnel.id} value={String(funnel.id)}>
                        {funnel.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeEditor())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('editSalesFunnel') : t('addSalesFunnel')}</DialogTitle>
            <DialogDescription>{t('salesFunnelFormDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sales-funnel-name">{t('salesFunnelName')}</Label>
              <Input
                id="sales-funnel-name"
                autoFocus
                value={draft.name}
                maxLength={120}
                placeholder={t('salesFunnelNamePlaceholder')}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && draft.name.trim() && !saveFunnel.isPending) saveFunnel.mutate();
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="sales-funnel-active">{t('salesFunnelActive')}</Label>
              <Switch
                id="sales-funnel-active"
                checked={draft.isActive}
                disabled={editing?.isDefault === true}
                onCheckedChange={(isActive) => setDraft((current) => ({ ...current, isActive }))}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="sales-funnel-default">{t('salesFunnelDefault')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t('salesFunnelDefaultDescription')}</p>
              </div>
              <Switch
                id="sales-funnel-default"
                checked={draft.isDefault}
                disabled={editing?.isDefault === true}
                onCheckedChange={(isDefault) => setDraft((current) => ({
                  ...current,
                  isDefault,
                  isActive: isDefault ? true : current.isActive,
                }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor} disabled={saveFunnel.isPending}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={() => saveFunnel.mutate()} disabled={!draft.name.trim() || saveFunnel.isPending}>
              {saveFunnel.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              {saveFunnel.isPending ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (open || deleteFunnel.isPending) return;
          setDeleteTarget(null);
          setTransferTargetId('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('salesFunnelDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? (deleteNeedsTransfer
                  ? t('salesFunnelDeleteDescription')
                  : t('salesFunnelDeleteEmptyDescription'))
                  .replace('{name}', deleteTarget.name)
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteNeedsTransfer ? (
            activeTransferTargets.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="sales-funnel-transfer">{t('salesFunnelTransferTarget')}</Label>
                <Select value={transferTargetId} onValueChange={setTransferTargetId}>
                  <SelectTrigger id="sales-funnel-transfer">
                    <SelectValue placeholder={t('selectSalesFunnel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTransferTargets.map((funnel) => (
                      <SelectItem key={funnel.id} value={String(funnel.id)}>{funnel.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-sm text-destructive">{t('salesFunnelDeleteUnavailable')}</p>
            )
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFunnel.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFunnel.isPending || (deleteNeedsTransfer && !transferTargetId)}
              onClick={(event) => {
                event.preventDefault();
                deleteFunnel.mutate();
              }}
            >
              {deleteFunnel.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {deleteNeedsTransfer ? t('transferAndDeleteSalesFunnel') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
