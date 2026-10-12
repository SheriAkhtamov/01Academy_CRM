import { composeGroupName, parseGroupName, previewGroupCode, type GroupCodeCatalogue } from '@shared/academy-group-code';
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { createGroupSchema, type GroupValues } from '@/lib/academyResourceSchemas';
import { academyDateInputValue } from '@/lib/localeFormat';
import { useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { futureGroupStatusNeedsConfirmation } from '@/components/ux/FutureGroupStartDialog';
import type { WeekScheduleItem } from '@/components/ux/WeekScheduleEditor';
import { getMinimumGroupEndDate } from '@shared/scheduling';
import { normalizeSchedule } from './schedule';
import { groupCodeCatalogueKey, invalidateGroupData } from './queries';
import type { Group, GroupConfiguration } from './types';

export const AUTO_TEACHER_VALUE = 'auto';
type GroupMutationValues = GroupValues & { allowFutureStart?: boolean };
export interface GroupEditorProps {
  open: boolean;
  group: Group | null;
  configuration: GroupConfiguration;
  onClose: () => void;
}

export function useGroupEditor({ open, group: editingGroup, configuration, onClose }: GroupEditorProps) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const existingCode = parseGroupName(editingGroup?.name);
  const autoNaming = !editingGroup || Boolean(existingCode);
  const codeCatalogue = useQuery<GroupCodeCatalogue>({
    queryKey: groupCodeCatalogueKey, enabled: open && !editingGroup,
    staleTime: 0, retry: false,
  });
  const { schools, rooms, courses, teachers } = configuration;
  const [groupSchedule, setGroupSchedule] = useState<WeekScheduleItem[]>([]);
  const [groupScheduleBaseline, setGroupScheduleBaseline] = useState<WeekScheduleItem[]>([]);
  const [futureGroupStartValues, setFutureGroupStartValues] = useState<GroupValues | null>(null);
  const groupForm = useForm<GroupValues>({
    resolver: zodResolver(useMemo(() => createGroupSchema(t), [t])),
    defaultValues: {
      name: '',
      nameSuffix: '', deliveryMode: 'offline', trainingType: 'GRP',
      courseId: '',
      schoolId: '',
      roomId: '',
      teacherId: AUTO_TEACHER_VALUE,
      lessonCount: 10,
      lessonDurationMinutes: 120,
      maxStudents: 12,
      status: 'open',
      startDate: '',
      endDate: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    const group = editingGroup;
    groupForm.reset(group ? {
      name: group.name,
      nameSuffix: parseGroupName(group.name)?.addition ?? '',
      deliveryMode: parseGroupName(group.name)?.deliveryMode ?? 'offline',
      trainingType: parseGroupName(group.name)?.trainingType ?? 'GRP',
      courseId: String(group.courseId),
      schoolId: String(group.schoolId),
      roomId: String(group.roomId),
      teacherId: group.teacherId ? String(group.teacherId) : AUTO_TEACHER_VALUE,
      lessonCount: group.lessonCount || 10,
      lessonDurationMinutes: group.lessonDurationMinutes || 120,
      maxStudents: group.maxStudents || 12,
      status: ['open', 'in_progress', 'frozen', 'completed'].includes(group.status)
        ? group.status as GroupValues['status']
        : 'open',
      startDate: academyDateInputValue(group.startDate),
      endDate: academyDateInputValue(group.endDate),
    } : {
      name: '',
      nameSuffix: '', deliveryMode: 'offline', trainingType: 'GRP',
      courseId: '',
      schoolId: '',
      roomId: '',
      teacherId: AUTO_TEACHER_VALUE,
      lessonCount: 10,
      lessonDurationMinutes: 120,
      maxStudents: 12,
      status: 'open',
      startDate: '',
      endDate: '',
    });
    setGroupSchedule(normalizeSchedule(group?.schedule, group?.lessonDurationMinutes || 120));
    setGroupScheduleBaseline(normalizeSchedule(group?.schedule, group?.lessonDurationMinutes || 120));
  }, [open, editingGroup, groupForm]);

  const saveGroup = useMutation({
    mutationFn: (values: GroupMutationValues) => {
      const teacherId = values.teacherId && values.teacherId !== AUTO_TEACHER_VALUE
        ? Number(values.teacherId)
        : null;
      const payload = {
        name: values.name,
        ...(autoNaming ? { nameSuffix: values.nameSuffix, deliveryMode: values.deliveryMode, trainingType: values.trainingType } : {}),
        courseId: Number(values.courseId),
        schoolId: Number(values.schoolId),
        roomId: Number(values.roomId),
        teacherId,
        schedule: groupSchedule,
        lessonCount: Number(values.lessonCount),
        lessonDurationMinutes: Number(values.lessonDurationMinutes),
        maxStudents: Number(values.maxStudents),
        status: values.status,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        autoAssign: !teacherId,
        allowFutureStart: values.allowFutureStart === true,
      };
      return editingGroup
        ? apiRequest('PATCH', `/api/academy/groups/${editingGroup.id}`, payload)
        : apiRequest('POST', '/api/academy/groups', payload);
    },
    onSuccess: () => {
      toast({
        title: editingGroup ? t('groupUpdated') : t('groupCreated'),
      });
      onClose();
      setFutureGroupStartValues(null);
      void invalidateGroupData(queryClient);
    },
    onError: (error: Error & { rawMessage?: string; data?: { minimumEndDate?: string } }) => {
      const errorCode = error.rawMessage ?? error.message;
      const backendMinimumEndDate = error.data?.minimumEndDate;
      const formattedBackendMinimumEndDate = backendMinimumEndDate
        ? new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${backendMinimumEndDate}T00:00:00Z`))
        : '';
      const description = errorCode === 'groupLessonsLockSchedule'
        ? t('groupLessonsLockSchedule')
        : errorCode === 'futureGroupInProgressRequiresConfirmation'
          ? t('futureGroupInProgressRequiresConfirmation')
        : errorCode === 'groupHasScheduledLessons'
          ? t('groupHasScheduledLessons')
          : errorCode === 'groupHasReservedLeads'
            ? t('groupHasReservedLeads')
            : errorCode === 'groupDateRangeTooShort' && formattedBackendMinimumEndDate
              ? t('groupDateRangeTooShort').replace('{date}', formattedBackendMinimumEndDate)
              : error.message;
      toast({ title: t('error'), description, variant: 'destructive' });
    },
  });

  const groupGuard = useUnsavedChangesGuard({
    open,
    isPending: saveGroup.isPending,
    isDirty: groupForm.formState.isDirty
      || JSON.stringify(groupSchedule) !== JSON.stringify(groupScheduleBaseline),
    onOpenChange: (nextOpen) => { if (!nextOpen) onClose(); },
  });

  const selectedGroupSchoolId = groupForm.watch('schoolId');
  const selectedGroupCourseId = groupForm.watch('courseId');
  const deliveryMode = groupForm.watch('deliveryMode');
  const trainingType = groupForm.watch('trainingType');
  const nameSuffix = groupForm.watch('nameSuffix');

  const groupCode = existingCode?.code ?? (codeCatalogue.data ? previewGroupCode(codeCatalogue.data, {
    schoolId: selectedGroupSchoolId, courseId: selectedGroupCourseId, deliveryMode, trainingType,
  }) : '');
  const groupCodeError = codeCatalogue.isError ? t('failedToLoadData')
    : codeCatalogue.data && selectedGroupCourseId && !codeCatalogue.data.courseCodes[selectedGroupCourseId] ? t('groupCodeCourseMissing')
      : codeCatalogue.data && deliveryMode === 'offline' && selectedGroupSchoolId && !codeCatalogue.data.schoolCodes[selectedGroupSchoolId] ? t('groupCodeBranchMissing') : '';
  useEffect(() => {
    if (open && autoNaming) groupForm.setValue('name', groupCode ? composeGroupName(groupCode, nameSuffix) : '');
  }, [open, autoNaming, groupCode, nameSuffix, groupForm]);

  const selectedGroupTeacherId = groupForm.watch('teacherId');
  const selectedGroupRoomId = groupForm.watch('roomId');
  const selectedGroupLessonCount = groupForm.watch('lessonCount');
  const selectedGroupStartDate = groupForm.watch('startDate');
  const selectedGroupEndDate = groupForm.watch('endDate');
  const minimumGroupEndDate = useMemo(() => getMinimumGroupEndDate({
    startDate: selectedGroupStartDate,
    lessonCount: Number(selectedGroupLessonCount),
    schedule: groupSchedule,
  }), [groupSchedule, selectedGroupLessonCount, selectedGroupStartDate]);
  const formattedMinimumGroupEndDate = useMemo(() => {
    if (!minimumGroupEndDate) return '';
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${minimumGroupEndDate}T00:00:00Z`));
  }, [language, minimumGroupEndDate]);
  const isGroupEndDateTooEarly = Boolean(
    minimumGroupEndDate
    && selectedGroupEndDate
    && selectedGroupEndDate < minimumGroupEndDate,
  );
  const submitGroupValues = (values: GroupValues) => {
    if (futureGroupStatusNeedsConfirmation(values)) {
      setFutureGroupStartValues(values);
      return;
    }
    if (!editingGroup && !groupCode) return;
    saveGroup.mutate(values);
  };

  useEffect(() => {
    if (isGroupEndDateTooEarly) {
      groupForm.setError('endDate', {
        type: 'scheduleRange',
        message: t('groupDateRangeTooShort').replace('{date}', formattedMinimumGroupEndDate),
      });
      return;
    }
    if (groupForm.getFieldState('endDate').error?.type === 'scheduleRange') {
      groupForm.clearErrors('endDate');
    }
  }, [
    formattedMinimumGroupEndDate,
    groupForm,
    isGroupEndDateTooEarly,
    selectedGroupEndDate,
    t,
  ]);

  const groupRooms = useMemo(
    () => rooms.filter((room) => (
      (room.isActive !== false || String(room.id) === selectedGroupRoomId) && String(room.schoolId) === selectedGroupSchoolId
    )),
    [rooms, selectedGroupSchoolId, selectedGroupRoomId],
  );
  const groupTeachers = useMemo(
    () => teachers
      .filter((teacher) => teacher.status === 'active' || String(teacher.id) === selectedGroupTeacherId)
      .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru')),
    [selectedGroupTeacherId, teachers],
  );
  return {
    t, language, schools, courses, groupForm, groupGuard, groupSchedule, setGroupSchedule,
    autoNaming, groupCode, groupCodeError, codeCatalogue, trainingType,
    selectedGroupSchoolId, selectedGroupStartDate, minimumGroupEndDate, formattedMinimumGroupEndDate,
    isGroupEndDateTooEarly, groupRooms, groupTeachers, saveGroup, submitGroupValues,
    futureGroupStartValues, setFutureGroupStartValues,
  };
}
