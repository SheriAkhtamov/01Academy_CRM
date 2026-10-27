import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Edit3,
  GitBranch,
  Globe2,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialogBody,
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
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import {
  isLeadIntegrationProvider,
  isWebsiteLeadIntegrationProvider,
  websiteIntegrationDomain,
  type LeadIntegrationProvider,
} from '@shared/lead-integrations';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

const FIXED_LEAD_SOURCE_PROVIDERS = [
  { provider: 'instagram', Icon: Camera },
  { provider: 'meta', Icon: RadioTower },
  { provider: 'onlinepbx', Icon: PhoneCall },
] as const;

type LeadSourceProvider = LeadIntegrationProvider;

type LeadIntegrationStatus = {
  provider: string;
  siteDomain?: string | null;
  acceptsLeads?: boolean;
};

type FunnelDraft = {
  name: string;
  isActive: boolean;
  isDefault: boolean;
  integrations: LeadSourceProvider[];
};

const emptyDraft = (): FunnelDraft => ({
  name: '',
  isActive: true,
  isDefault: false,
  integrations: [],
});

const integrationKey = (provider: string) => {
  switch (provider) {
    case 'instagram': return 'instagramIntegration' as const;
    case 'meta': return 'metaIntegration' as const;
    case 'onlinepbx': return 'onlinePbxIntegration' as const;
    default: return 'navIntegrations' as const;
  }
};

const integrationLabel = (
  provider: string,
  t: ReturnType<typeof useTranslation>['t'],
) => websiteIntegrationDomain(provider) ?? t(integrationKey(provider));

export function SalesFunnelsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SalesFunnel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<FunnelDraft>(() => emptyDraft());
  const [initialDraft, setInitialDraft] = useState<FunnelDraft>(() => emptyDraft());
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const mutationLocks = useRef({ save: false, delete: false });
  const [deleteTarget, setDeleteTarget] = useState<SalesFunnel | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');

  const funnels = useQuery<SalesFunnel[]>({ queryKey: ['/api/academy/sales-funnels'] });
  const integrationStatuses = useQuery<LeadIntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
  });
  const leadSourceProviders = useMemo(() => {
    const websiteProviders = new Set<LeadIntegrationProvider>();
    for (const integration of integrationStatuses.data ?? []) {
      if (integration.acceptsLeads && isWebsiteLeadIntegrationProvider(integration.provider)) {
        websiteProviders.add(integration.provider);
      }
    }
    for (const funnel of funnels.data ?? []) {
      for (const provider of funnel.integrations) {
        if (isWebsiteLeadIntegrationProvider(provider)) websiteProviders.add(provider);
      }
    }
    return [
      ...[...websiteProviders]
        .sort((left, right) => left.localeCompare(right))
        .map((provider) => ({ provider, Icon: Globe2 })),
      ...FIXED_LEAD_SOURCE_PROVIDERS,
    ];
  }, [funnels.data, integrationStatuses.data]);
  const activeFunnels = useMemo(
    () => (funnels.data ?? []).filter((funnel) => funnel.isActive),
    [funnels.data],
  );
  const activeTransferTargets = useMemo(
    () => activeFunnels.filter((funnel) => funnel.id !== deleteTarget?.id),
    [activeFunnels, deleteTarget?.id],
  );
  const deleteNeedsTransfer = Boolean(
    deleteTarget
    && (deleteTarget.isDefault || deleteTarget.leadCount > 0
      || deleteTarget.employeeCount > 0 || deleteTarget.integrationCount > 0),
  );

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['/api/academy/sales-funnels'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/configuration'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/users'] }),
  ]);

  const closeEditor = () => {
    setDialogOpen(false);
    setEditing(null);
    setDraft(emptyDraft());
  };

  const openEditor = (funnel?: SalesFunnel) => {
    setEditing(funnel ?? null);
    const nextDraft = funnel
      ? {
        name: funnel.name,
        isActive: funnel.isActive,
        isDefault: funnel.isDefault,
        integrations: funnel.integrations.filter(isLeadIntegrationProvider),
      }
      : emptyDraft();
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setIntegrationsOpen(false);
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
    onSettled: () => { mutationLocks.current.save = false; },
  });

  const editorGuard = useUnsavedChangesGuard({
    open: dialogOpen,
    isDirty: draft.name !== initialDraft.name
      || draft.isActive !== initialDraft.isActive
      || draft.isDefault !== initialDraft.isDefault
      || draft.integrations.length !== initialDraft.integrations.length
      || draft.integrations.some(provider => !initialDraft.integrations.includes(provider)),
    isPending: saveFunnel.isPending,
    onOpenChange: (open) => {
      if (open) setDialogOpen(true);
      else closeEditor();
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
    onSettled: () => { mutationLocks.current.delete = false; },
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
      key: 'employeeCount',
      header: t('employees'),
      accessor: (funnel) => Number(funnel.employeeCount),
      sortable: true,
      render: (funnel) => Number(funnel.employeeCount).toLocaleString(),
    },
    {
      key: 'integrations',
      header: t('funnelIntegrations'),
      accessor: (funnel) => Number(funnel.integrationCount),
      render: (funnel) => (
        <div className="flex flex-wrap gap-1.5">
          {funnel.integrations.length > 0
            ? funnel.integrations.map((provider) => (
              <Badge key={provider} variant="outline">{integrationLabel(provider, t)}</Badge>
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

      <Dialog open={dialogOpen} onOpenChange={editorGuard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="compact-modal-header">
            <DialogTitle className="text-base leading-6">{editing ? t('editSalesFunnel') : t('addSalesFunnel')}</DialogTitle>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim() || mutationLocks.current.save) return;
            mutationLocks.current.save = true;
            saveFunnel.mutate();
          }}>
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection title={t('salesFunnelSettings')} icon={GitBranch} tone="sky" collapsible={false} disabled={saveFunnel.isPending} sectionId="funnel-settings" contentClassName="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="sales-funnel-name">{t('salesFunnelName')}</Label>
                  <Input
                    id="sales-funnel-name"
                    autoFocus
                    value={draft.name}
                    maxLength={120}
                    disabled={saveFunnel.isPending}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                  <Label htmlFor="sales-funnel-active">{t('salesFunnelActive')}</Label>
                  <Switch
                    id="sales-funnel-active"
                    checked={draft.isActive}
                    disabled={saveFunnel.isPending || editing?.isDefault === true || draft.isDefault || draft.integrations.length > 0}
                    onCheckedChange={(isActive) => setDraft((current) => ({ ...current, isActive }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                  <div>
                    <Label htmlFor="sales-funnel-default">{t('salesFunnelDefault')}</Label>
                  </div>
                  <Switch
                    id="sales-funnel-default"
                    checked={draft.isDefault}
                    disabled={saveFunnel.isPending || editing?.isDefault === true}
                    onCheckedChange={(isDefault) => setDraft((current) => ({
                      ...current,
                      isDefault,
                      isActive: isDefault ? true : current.isActive,
                      integrations: isDefault && editing
                        ? [...new Set([
                          ...current.integrations,
                          ...editing.integrations.filter(isLeadIntegrationProvider),
                        ])]
                        : current.integrations,
                    }))}
                  />
                </div>
              </CompactModalSection>
              <CompactModalSection
                title={t('funnelIntegrations')}
                icon={RadioTower}
                tone="teal"
                count={draft.integrations.length}
                summary={draft.integrations.map(provider => integrationLabel(provider, t)).join(', ')}
                open={integrationsOpen}
                onOpenChange={setIntegrationsOpen}
                disabled={saveFunnel.isPending}
                sectionId="funnel-integrations"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {leadSourceProviders.map(({ provider, Icon }) => {
                    const isSelected = draft.integrations.includes(provider);
                    const isLockedToDefault = Boolean(
                      draft.isDefault && editing?.integrations.includes(provider),
                    );

                    return (
                      <div
                        key={provider}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2"
                      >
                        <Label
                          htmlFor={`sales-funnel-source-${provider}`}
                          className="flex min-w-0 items-center gap-2"
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{integrationLabel(provider, t)}</span>
                        </Label>
                        <Switch
                          id={`sales-funnel-source-${provider}`}
                          checked={isSelected}
                          disabled={saveFunnel.isPending || isLockedToDefault}
                          onCheckedChange={(checked) => setDraft((current) => ({
                            ...current,
                            isActive: checked ? true : current.isActive,
                            integrations: checked
                              ? [...new Set([...current.integrations, provider])]
                              : current.integrations.filter((entry) => entry !== provider),
                          }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </CompactModalSection>
            </div>
            <DialogFooter className="compact-modal-footer">
              <Button type="button" variant="outline" onClick={() => editorGuard.handleOpenChange(false)} disabled={saveFunnel.isPending}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={!draft.name.trim() || saveFunnel.isPending}>
                {saveFunnel.isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : null}
                {saveFunnel.isPending ? t('saving') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (open || deleteFunnel.isPending) return;
          setDeleteTarget(null);
          setTransferTargetId('');
        }}
        pending={deleteFunnel.isPending}>
        <AlertDialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0">
          <AlertDialogHeader className="compact-modal-header">
            <AlertDialogTitle className="text-base leading-6">{t('salesFunnelDeleteTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {deleteTarget
                ? (deleteNeedsTransfer
                  ? t('salesFunnelDeleteDescription')
                  : t('salesFunnelDeleteEmptyDescription'))
                  .replace('{name}', deleteTarget.name)
                : ''}
            </AlertDialogDescription>
            {deleteNeedsTransfer ? (
              <>
                <CompactModalSection title={t('salesFunnelTransferTarget')} icon={GitBranch} tone="amber" collapsible={false} disabled={deleteFunnel.isPending} sectionId="funnel-transfer">
                  {activeTransferTargets.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="sales-funnel-transfer">{t('salesFunnelTransferTarget')}</Label>
                      <Select value={transferTargetId} onValueChange={setTransferTargetId} disabled={deleteFunnel.isPending}>
                        <SelectTrigger id="sales-funnel-transfer">
                          <SelectValue />
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
                  )}
                </CompactModalSection>
              </>
            ) : null}
          </AlertDialogBody>
          <AlertDialogFooter className="compact-modal-footer">
            <AlertDialogCancel disabled={deleteFunnel.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFunnel.isPending || (deleteNeedsTransfer && !activeTransferTargets.some(funnel => String(funnel.id) === transferTargetId))}
              onClick={(event) => {
                event.preventDefault();
                if (mutationLocks.current.delete || (deleteNeedsTransfer && !activeTransferTargets.some(funnel => String(funnel.id) === transferTargetId))) return;
                mutationLocks.current.delete = true;
                deleteFunnel.mutate();
              }}
            >
              {deleteFunnel.isPending ? <OrbitSpinner className="mr-1.5 h-4 w-4" /> : null}
              {deleteNeedsTransfer ? t('transferAndDeleteSalesFunnel') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog
        open={editorGuard.confirmationOpen}
        onOpenChange={editorGuard.setConfirmationOpen}
        onDiscard={editorGuard.discardChanges}
      />
    </>
  );
}
