import { useMutation } from '@tanstack/react-query';
import { groupsApi } from '@/features/groups/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

type ArchivableGroup = { id: number; name: string };

/**
 * Shelving a group is offered on two screens — the teacher's own group list and
 * the administration settings — and both owe the user the same four sentences:
 * moved, restored, and the two ways either can fail. Keeping the pair of
 * mutations here is what stops the wording, and the decision about what a
 * failure looks like, from drifting apart between them.
 *
 * `onSuccess` is the caller's, because the two screens refetch different
 * queries and close different dialogs.
 */
export function useGroupArchive<TGroup extends ArchivableGroup>(
  onSuccess: (group: TGroup, archived: boolean) => void,
) {
  const { t } = useTranslation();

  const archiveGroup = useMutation<unknown, Error, TGroup>({
    mutationFn: (group) => groupsApi.archive(group.id),
    onSuccess: (_result, group) => {
      toast({ title: t('groupArchived'), description: group.name });
      onSuccess(group, true);
    },
    onError: (error) => toast({
      title: t('groupArchiveFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const restoreGroup = useMutation<unknown, Error, TGroup>({
    mutationFn: (group) => groupsApi.unarchive(group.id),
    onSuccess: (_result, group) => {
      toast({ title: t('groupRestoredFromArchive'), description: group.name });
      onSuccess(group, false);
    },
    onError: (error) => toast({
      title: t('groupRestoreFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  /* One id, so a card can show its own spinner without either screen having to
     work out which of the two mutations is running. */
  const pendingGroupId = archiveGroup.isPending
    ? Number(archiveGroup.variables?.id)
    : restoreGroup.isPending
      ? Number(restoreGroup.variables?.id)
      : null;

  return { archiveGroup, restoreGroup, pendingGroupId };
}
