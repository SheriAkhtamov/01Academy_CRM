import { useEffect, useState } from 'react';
import { ArrowRightLeft, GitBranch, Trash2, UsersRound } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/useTranslation';

type BulkAction = 'status' | 'manager' | 'delete';

interface BulkLeadActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  statuses: Array<{ code: string; name: string }>;
  managers: Array<{ id: number; fullName: string }>;
  canManageAllLeads: boolean;
  isPending: boolean;
  onMove: (statusCode: string) => Promise<void>;
  onAssign: (managerId: number) => Promise<void>;
  onDelete: () => Promise<void>;
  onClearSelection: () => void;
}

export function BulkLeadActionsDialog({
  open,
  onOpenChange,
  selectedCount,
  statuses,
  managers,
  canManageAllLeads,
  isPending,
  onMove,
  onAssign,
  onDelete,
  onClearSelection,
}: BulkLeadActionsDialogProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<BulkAction>('status');
  const [targetStatusCode, setTargetStatusCode] = useState('');
  const [targetManagerId, setTargetManagerId] = useState('');
  const [firstDeleteConfirmationOpen, setFirstDeleteConfirmationOpen] = useState(false);
  const [finalDeleteConfirmationOpen, setFinalDeleteConfirmationOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAction('status');
    setTargetStatusCode('');
    setTargetManagerId('');
    setFirstDeleteConfirmationOpen(false);
    setFinalDeleteConfirmationOpen(false);
  }, [open]);

  const runMove = async () => {
    if (!targetStatusCode) return;
    try {
      await onMove(targetStatusCode);
    } catch {
      // The mutation owns the localized error toast; keep the dialog open for retry.
    }
  };

  const runAssign = async () => {
    const managerId = Number(targetManagerId);
    if (!managerId) return;
    try {
      await onAssign(managerId);
    } catch {
      // The mutation owns the localized error toast; keep the dialog open for retry.
    }
  };

  const runDelete = async () => {
    try {
      await onDelete();
      setFinalDeleteConfirmationOpen(false);
    } catch {
      // The mutation owns the localized error toast; keep the final confirmation open.
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle>{t('bulkLeadActionsTitle')}</DialogTitle>
              <Badge variant="secondary">
                {t('selectedLeadsCount').replace('{count}', String(selectedCount))}
              </Badge>
            </div>
            <DialogDescription>
              {t('bulkLeadActionsDescription').replace('{count}', String(selectedCount))}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={action} onValueChange={(value) => setAction(value as BulkAction)}>
            <TabsList className={canManageAllLeads ? 'grid h-auto w-full grid-cols-3' : 'grid h-auto w-full grid-cols-1'}>
              <TabsTrigger value="status" className="gap-2 py-2.5">
                <GitBranch className="size-4" />
                {t('bulkMoveToStage')}
              </TabsTrigger>
              {canManageAllLeads ? (
                <TabsTrigger value="manager" className="gap-2 py-2.5">
                  <UsersRound className="size-4" />
                  {t('bulkAssignManager')}
                </TabsTrigger>
              ) : null}
              {canManageAllLeads ? (
                <TabsTrigger
                  value="delete"
                  className="gap-2 py-2.5 data-[state=active]:text-destructive"
                >
                  <Trash2 className="size-4" />
                  {t('bulkDeleteLeads')}
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="status" className="space-y-4 pt-3">
              <p className="text-sm text-muted-foreground">{t('bulkMoveToStageDescription')}</p>
              <div className="space-y-2">
                <Label htmlFor="bulk-lead-status">{t('selectTargetStage')}</Label>
                <Select value={targetStatusCode} onValueChange={setTargetStatusCode}>
                  <SelectTrigger id="bulk-lead-status">
                    <SelectValue placeholder={t('selectTargetStage')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statuses.map((status) => (
                        <SelectItem key={status.code} value={status.code}>{status.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {statuses.length === 0 ? (
                  <p className="text-xs text-destructive">{t('bulkMoveNoAvailableStages')}</p>
                ) : null}
              </div>
            </TabsContent>

            {canManageAllLeads ? (
              <TabsContent value="manager" className="space-y-4 pt-3">
                <p className="text-sm text-muted-foreground">{t('bulkAssignManagerDescription')}</p>
                <div className="space-y-2">
                  <Label htmlFor="bulk-lead-manager">{t('selectManager')}</Label>
                  <Select value={targetManagerId} onValueChange={setTargetManagerId}>
                    <SelectTrigger id="bulk-lead-manager">
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
                </div>
              </TabsContent>
            ) : null}

            {canManageAllLeads ? (
              <TabsContent value="delete" className="space-y-3 pt-3">
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-start gap-3">
                    <Trash2 className="mt-0.5 size-5 shrink-0 text-destructive" />
                    <p className="text-sm text-muted-foreground">{t('bulkDeleteLeadsDescription')}</p>
                  </div>
                </div>
              </TabsContent>
            ) : null}
          </Tabs>

          <DialogFooter className="sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onClearSelection();
                onOpenChange(false);
              }}
              disabled={isPending}
            >
              {t('clearSelection')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                {t('cancel')}
              </Button>
              {action === 'status' ? (
                <Button type="button" onClick={() => void runMove()} disabled={!targetStatusCode || isPending}>
                  <GitBranch data-icon="inline-start" />
                  {isPending ? t('saving') : t('bulkMoveLeads')}
                </Button>
              ) : null}
              {action === 'manager' && canManageAllLeads ? (
                <Button type="button" onClick={() => void runAssign()} disabled={!targetManagerId || isPending}>
                  <ArrowRightLeft data-icon="inline-start" />
                  {isPending ? t('saving') : t('assignSelected')}
                </Button>
              ) : null}
              {action === 'delete' && canManageAllLeads ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setFirstDeleteConfirmationOpen(true)}
                  disabled={isPending}
                >
                  <Trash2 data-icon="inline-start" />
                  {t('bulkDeleteLeads')}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={firstDeleteConfirmationOpen} onOpenChange={setFirstDeleteConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bulkDeleteFirstTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bulkDeleteFirstDescription').replace('{count}', String(selectedCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                setFirstDeleteConfirmationOpen(false);
                setFinalDeleteConfirmationOpen(true);
              }}
            >
              {t('bulkDeleteFirstContinue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={finalDeleteConfirmationOpen} onOpenChange={setFinalDeleteConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bulkDeleteFinalTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bulkDeleteFinalDescription').replace('{count}', String(selectedCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                void runDelete();
              }}
            >
              {isPending ? t('saving') : t('bulkDeleteFinalAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
