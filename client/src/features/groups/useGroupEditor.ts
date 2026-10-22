import { composeGroupName, parseGroupName, previewGroupCode, type GroupCodeCatalogue } from '@shared/academy-group-code';
import { flattenCourseCurriculum } from '@shared/contracts/course-curriculum';
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
import { getMinimumGroupEndDate, type GroupScheduleValidationError } from '@shared/scheduling';
import { normalizeSchedule } from './schedule';
import { groupCodeCatalogueKey, invalidateGroupData } from './queries';
import { findTeacherConflict, findRoomClashes } from './editorInsights';
import type { Group, GroupConfiguration } from './types';

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
  const [scheduleError, setScheduleError] = useState<GroupScheduleValidationError | null>(null);
  /*
    The end date follows the start, the lesson count and the schedule until
    someone types a date of their own. It is recalculated in those fields'
    change handlers rather than in an effect, so merely opening a group never
    marks the form as changed or carries a date over from the previous group.
  */
  const [endDateFollowsSchedule, setEndDateFollowsSchedule] = useState(true);
  const groupForm = useForm<GroupValues>({
    shouldFocusError: false,
    resolver: zodResolver(useMemo(() => createGroupSchema(t, Boolean(editingGroup && !editingGroup.teacherId)), [t, editingGroup])),
    defaultValues: {
      name: '',
      nameSuffix: '', deliveryMode: 'offline', trainingType: 'GRP',
      courseId: '',
      schoolId: '',
      roomId: '',
      teacherId: '',
      selectedCourseLessonIds: [],
      lessonCount: 0,
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
      teacherId: group.teacherId ? String(group.teacherId) : '',
      selectedCourseLessonIds: group.selectedCourseLessonIds ?? null,
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
      teacherId: '',
      selectedCourseLessonIds: [],
      lessonCount: 0,
      lessonDurationMinutes: 120,
      maxStudents: 12,
      status: 'open',
      startDate: '',
      endDate: '',
    });
    const schedule = normalizeSchedule(group?.schedule, group?.lessonDurationMinutes || 120);
    setGroupSchedule(schedule);
    setGroupScheduleBaseline(schedule);
    setScheduleError(null);
    const endDate = academyDateInputValue(group?.endDate);
    setEndDateFollowsSchedule(!group || (Boolean(endDate) && endDate === getMinimumGroupEndDate({
      startDate: academyDateInputValue(group.startDate),
      lessonCount: Number(group.lessonCount || 10),
      schedule,
    })));
  }, [open, editingGroup, groupForm]);

  const saveGroup = useMutation({
    mutationFn: (values: GroupMutationValues) => {
      if (!editingGroup && (!groupCode || codeCatalogue.isError || codeCatalogue.isFetching)) {
        throw new Error(t('failedToLoadData'));
      }
      const teacherId = values.teacherId ? Number(values.teacherId) : null;
      const payload = {
        name: values.name,
        ...(autoNaming ? { nameSuffix: values.nameSuffix, deliveryMode: values.deliveryMode, trainingType: values.trainingType } : {}),
        courseId: Number(values.courseId),
        schoolId: Number(values.schoolId),
        roomId: Number(values.roomId),
        teacherId,
        schedule: groupSchedule,
        ...(values.selectedCourseLessonIds !== null ? { selectedCourseLessonIds: values.selectedCourseLessonIds } : {}),
        lessonCount: Number(values.lessonCount),
        lessonDurationMinutes: Number(values.lessonDurationMinutes),
        maxStudents: Number(values.maxStudents),
        status: values.status,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
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
  const selectedCourse = courses.find((course) => String(course.id) === selectedGroupCourseId);
  const deliveryMode = groupForm.watch('deliveryMode');
  const trainingType = groupForm.watch('trainingType');
  const nameSuffix = groupForm.watch('nameSuffix');

  const groupCode = existingCode?.code ?? (codeCatalogue.data ? previewGroupCode(codeCatalogue.data, {
    schoolId: selectedGroupSchoolId, courseId: selectedGroupCourseId, deliveryMode, trainingType,
  }) : '');
  const groupCodeError = editingGroup ? '' : codeCatalogue.isError ? t('failedToLoadData')
    : codeCatalogue.data && selectedGroupCourseId && !codeCatalogue.data.courseCodes[selectedGroupCourseId] ? t('groupCodeCourseMissing')
      : codeCatalogue.data && deliveryMode === 'offline' && selectedGroupSchoolId && !codeCatalogue.data.schoolCodes[selectedGroupSchoolId] ? t('groupCodeBranchMissing') : '';
  useEffect(() => {
    if (open && autoNaming) groupForm.setValue('name', groupCode ? composeGroupName(groupCode, nameSuffix) : '');
  }, [open, autoNaming, groupCode, nameSuffix, groupForm]);

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
    if (!editingGroup && (!groupCode || codeCatalogue.isError || codeCatalogue.isFetching)) return;
    if (values.selectedCourseLessonIds !== null) {
      const availableIds = new Set(flattenCourseCurriculum(selectedCourse?.program).map((lesson) => lesson.id));
      if (values.selectedCourseLessonIds.some((id) => !availableIds.has(id))) {
        groupForm.setError('selectedCourseLessonIds', {
          type: 'courseLesson', message: t('groupCourseLessonsUnavailable'),
        });
        return;
      }
    }
    // An old unassigned group can retain metadata, but a new lesson plan needs
    // an explicit teacher just like creation. Compare values, not dirty flags,
    // so reverting a field still allows the original metadata-only save.
    if (editingGroup && !values.teacherId) {
      const planChanged = (['courseId', 'schoolId', 'roomId', 'lessonCount', 'lessonDurationMinutes'] as const)
        .some((field) => Number(values[field]) !== Number(editingGroup[field]))
        || JSON.stringify(values.selectedCourseLessonIds) !== JSON.stringify(editingGroup.selectedCourseLessonIds ?? null)
        || values.startDate !== academyDateInputValue(editingGroup.startDate)
        || values.endDate !== academyDateInputValue(editingGroup.endDate)
        || JSON.stringify(groupSchedule) !== JSON.stringify(groupScheduleBaseline);
      if (planChanged) {
        groupForm.setError('teacherId', { type: 'required', message: t('teacherRequired') });
        return;
      }
    }
    if (futureGroupStatusNeedsConfirmation(values)) {
      setFutureGroupStartValues(values);
      return;
    }
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

  const followEndDate = (next: { startDate?: string; lessonCount?: number; schedule?: WeekScheduleItem[] }) => {
    if (!endDateFollowsSchedule) return;
    const values = groupForm.getValues();
    const earliest = getMinimumGroupEndDate({
      startDate: next.startDate ?? values.startDate,
      lessonCount: Number(next.lessonCount ?? values.lessonCount),
      schedule: next.schedule ?? groupSchedule,
    });
    if (earliest && earliest !== values.endDate) {
      groupForm.setValue('endDate', earliest, { shouldDirty: true, shouldValidate: groupForm.formState.isSubmitted });
    }
  };
  const updateGroupSchedule = (schedule: WeekScheduleItem[]) => {
    setGroupSchedule(schedule);
    setScheduleError(null);
    followEndDate({ schedule });
  };
  const updateSelectedLessons = (ids: string[]) => {
    groupForm.setValue('selectedCourseLessonIds', ids, { shouldDirty: true, shouldValidate: true });
    groupForm.setValue('lessonCount', ids.length, { shouldDirty: true });
    followEndDate({ lessonCount: ids.length });
  };
  const updateSelectedCourse = (courseId: string) => {
    if (courseId === groupForm.getValues('courseId')) return;
    groupForm.setValue('courseId', courseId, { shouldDirty: true, shouldValidate: true });
    const course = courses.find((candidate) => String(candidate.id) === courseId);
    updateSelectedLessons(flattenCourseCurriculum(course?.program).map((lesson) => lesson.id));
  };
  const applyScheduleEndDate = () => {
    if (!minimumGroupEndDate) return;
    groupForm.setValue('endDate', minimumGroupEndDate, { shouldDirty: true, shouldValidate: true });
    setEndDateFollowsSchedule(true);
  };
  const releaseEndDate = () => setEndDateFollowsSchedule(false);

  const groupRooms = useMemo(
    () => rooms.filter((room) => (
      (room.isActive !== false || String(room.id) === selectedGroupRoomId) && String(room.schoolId) === selectedGroupSchoolId
    )),
    [rooms, selectedGroupSchoolId, selectedGroupRoomId],
  );
  const groupTeachers = useMemo(
    () => teachers
      .filter((teacher) => teacher.status === 'active')
      .sort((left, right) => left.fullName.localeCompare(right.fullName, language) || left.id - right.id),
    [teachers, language],
  );

  // A completed group is saved without the room and teacher checks, so it gets no warnings either.
  const selectedGroupStatus = groupForm.watch('status');
  const scheduleChecksApply = selectedGroupStatus !== 'completed';
  const plannedGroup = useMemo(() => ({
    schedule: groupSchedule,
    startDate: selectedGroupStartDate,
    endDate: selectedGroupEndDate,
    editingGroupId: editingGroup?.id ?? null,
  }), [editingGroup?.id, groupSchedule, selectedGroupEndDate, selectedGroupStartDate]);
  const roomClashes = useMemo(() => (
    scheduleChecksApply && selectedGroupRoomId
      ? findRoomClashes(Number(selectedGroupRoomId), plannedGroup, configuration.groups)
      : []
  ), [configuration.groups, plannedGroup, scheduleChecksApply, selectedGroupRoomId]);
  const busyRoomIds = useMemo(() => new Set(scheduleChecksApply
    ? groupRooms
      .filter((room) => findRoomClashes(room.id, plannedGroup, configuration.groups).length > 0)
      .map((room) => room.id)
    : []), [configuration.groups, groupRooms, plannedGroup, scheduleChecksApply]);
  const selectedTeacherId = groupForm.watch('teacherId');
  const selectedTeacherConflict = useMemo(() => {
    const teacher = groupTeachers.find((candidate) => String(candidate.id) === selectedTeacherId);
    if (!teacher || !scheduleChecksApply || !selectedGroupSchoolId || groupSchedule.length === 0) return null;
    return findTeacherConflict(teacher, { ...plannedGroup, schoolId: Number(selectedGroupSchoolId) }, configuration.groups);
  }, [configuration.groups, groupSchedule.length, groupTeachers, plannedGroup, scheduleChecksApply,
    selectedTeacherId, selectedGroupSchoolId]);
  return {
    t, language, schools, courses, groupForm, groupGuard, groupSchedule, updateGroupSchedule,
    selectedCourse, updateSelectedCourse, updateSelectedLessons,
    autoNaming, groupCode, groupCodeError, codeCatalogue, trainingType,
    selectedGroupSchoolId, selectedGroupStartDate, minimumGroupEndDate, formattedMinimumGroupEndDate,
    isGroupEndDateTooEarly, groupRooms, saveGroup, submitGroupValues,
    futureGroupStartValues, setFutureGroupStartValues,
    scheduleError, setScheduleError, followEndDate, applyScheduleEndDate, releaseEndDate,
    roomClashes, busyRoomIds, selectedTeacherConflict, groupTeachers,
  };
}
