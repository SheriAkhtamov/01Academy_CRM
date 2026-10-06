import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { schoolArchiveApi, roomArchiveApi, courseArchiveApi } from './api';

const resourceLabels = (t: (key: TranslationKey) => string) => ({
  schools: { archive: t('archiveSchool'), restore: t('restoreSchool'), archiveTitle: t('archiveSchoolTitle'), restoreTitle: t('restoreSchoolTitle'), archiveConfirm: t('archiveSchoolConfirm'), restoreConfirm: t('restoreSchoolConfirm'), archived: t('schoolArchived'), restored: t('schoolRestored') },
  rooms: { archive: t('archiveRoom'), restore: t('restoreRoom'), archiveTitle: t('archiveRoomTitle'), restoreTitle: t('restoreRoomTitle'), archiveConfirm: t('archiveRoomConfirm'), restoreConfirm: t('restoreRoomConfirm'), archived: t('roomArchived'), restored: t('roomRestored') },
  courses: { archive: t('archiveCourse'), restore: t('restoreCourse'), archiveTitle: t('archiveCourseTitle'), restoreTitle: t('restoreCourseTitle'), archiveConfirm: t('archiveCourseConfirm'), restoreConfirm: t('restoreCourseConfirm'), archived: t('courseArchived'), restored: t('courseRestored') },
});

export function useResourceArchive<T extends { id: number; name: string; isArchived?: boolean }>(resource: 'schools' | 'rooms' | 'courses', onChanged: () => void | Promise<unknown>) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [target, setTarget] = useState<{ row: T; archived: boolean } | null>(null);
  const keys = resourceLabels(t)[resource];
  const api = resource === 'schools' ? schoolArchiveApi : resource === 'rooms' ? roomArchiveApi : courseArchiveApi;
  const mutation = useMutation({
    mutationFn: ({ row, archived }: { row: T; archived: boolean }) => archived ? api.archive(row.id) : api.restore(row.id),
    onSuccess: async (_result, variables) => {
      setTarget(null);
      toast({ title: variables.archived ? keys.archived : keys.restored });
      await onChanged();
    },
  });
  const actionLabel = (isArchived?: boolean) => isArchived ? keys.restore : keys.archive;
  return {
    mutation, actionLabel,
    openArchive: (row: T) => { mutation.reset(); setTarget({ row, archived: !row.isArchived }); },
    dialogProps: {
      open: target !== null,
      onOpenChange: (open: boolean) => { if (!open && !mutation.isPending) setTarget(null); },
      title: target?.archived ? keys.archiveTitle : keys.restoreTitle,
      description: (target?.archived ? keys.archiveConfirm : keys.restoreConfirm).replace('{name}', target?.row.name ?? ''),
      confirmLabel: actionLabel(!target?.archived), keepOpenOnConfirm: true, isPending: mutation.isPending,
      error: mutation.error?.message,
      onConfirm: () => { if (target) mutation.mutate(target); },
    },
  };
}
