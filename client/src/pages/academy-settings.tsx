import { CourseEditorDialog } from '@/features/course-curriculum/CourseEditorDialog';
import { canEditCourseCurriculum } from '@/features/course-curriculum/editor-model';
import { normalizeCourseCurriculum } from '@shared/contracts/course-curriculum';
import { GroupsWorkspace } from '@/features/groups/GroupsWorkspace';
import { groupConfigurationKey } from '@/features/groups/queries';
import type { Group, GroupConfiguration, GroupTeacher } from '@/features/groups/types';
import { TimezoneSelect } from '@/features/academy-resources/TimezoneSelect';
import { SchoolSettingsTable, RoomSettingsTable, CourseSettingsTable } from '@/features/academy-resources/ResourceSettingsTables';
import type { School, Room, Course } from '@/features/academy-resources/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AcademyPortalAccess } from '@/features/portal-access/AcademyPortalAccess';
import { ContractsDirectory } from '@/features/student-contracts/ContractsDirectory';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useLocation, useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createCourseSchema,
  createRoomSchema,
  createSchoolSchema,
  createStatusSchema,
  type CourseValues,
  type RoomValues,
  type SchoolValues,
  type StatusValues,
} from '@/lib/academyResourceSchemas';
import { formatAcademyNumber } from '@/lib/localeFormat';
import { toast } from '@/hooks/use-toast';
import { LeadAssignmentContent } from '@/pages/admin-leads';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DialogFooter,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';
import { buildUniqueCourseSlug } from '@/lib/slugify';
import { formatLeadCount } from '@/lib/formatLeadCount';
import { Input } from '@/components/ui/input';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import { PageHeader } from '@/components/ux/PageHeader';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { LeadMergePanel } from '@/components/ux/LeadMergePanel';
import { KpiSettingsPanel } from '@/features/sales-kpi/ui/KpiSettingsPanel';
import { SalesFunnelsPanel } from '@/features/sales-funnels/SalesFunnelsPanel';
import type { SalesFunnel } from '@/features/sales-funnels/api';
import { LeadDistributionPanel } from '@/features/lead-distribution/LeadDistributionPanel';
import { stagesForSalesFunnel } from '@shared/sales-funnel-workflow';
import {
  ArrowDown,
  ArrowUp,
  ArrowRightLeft,
  BookOpen,
  Building2,
  ChevronRight,
  DoorOpen,
  Edit3,
  FileSignature,
  GitBranch,
  Plus,
  Trash2,
  Target,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
import { LoadingRegion } from '@/components/ui/loading-region';


interface PipelineStatus {
  id: number;
  code: string;
  name: string;
  funnelId?: number | null;
  color: string;
  sortOrder: number;
  isPipeline: boolean;
  isSystem: boolean;
  isActive: boolean;
}

interface ConfigurationData {
  schools: School[];
  rooms: Room[];
  courses: Course[];
  statuses: PipelineStatus[];
  teachers: GroupTeacher[];
  groups: Group[];
}

function EmptyTableState({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
        <Building2 className="text-muted-foreground" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
    </div>
  );
}

const academyConfigurationTabs = ['schools', 'rooms', 'courses', 'groups', 'contracts', 'access'];
const salesSettingsTabs = ['lead-assignment', 'pipeline', 'funnels', 'lead-merge', 'kpi'];

interface AcademySettingsProps {
  mode?: 'academy' | 'sales';
}

export default function AcademySettings({ mode = 'academy' }: AcademySettingsProps) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const routeSearch = useSearch();
  const [, navigate] = useLocation();
  const requestedTab = new URLSearchParams(routeSearch).get('tab');
  const requestedFilter = new URLSearchParams(routeSearch).get('filter');
  const isSalesSettingsMode = mode === 'sales';
  const availableTabs = isSalesSettingsMode ? salesSettingsTabs : academyConfigurationTabs;
  const defaultTab = isSalesSettingsMode ? 'lead-assignment' : 'schools';
  const basePath = isSalesSettingsMode ? '/admin/sales-settings' : '/admin/academy-settings';
  const requestedTabValue = availableTabs.includes(String(requestedTab)) ? String(requestedTab) : defaultTab;
  const leadCountLabels = useMemo(
    () => ({
      one: t('leadCountOne'),
      few: t('leadCountFew'),
      many: t('leadCountMany'),
    }),
    [t],
  );
  const [activeTab, setActiveTab] = useState(requestedTabValue);
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const schoolTimezonePopupRef = useRef(false);
  const resourceSaveLocks = useRef({ school: false, room: false, status: false, stageTransfer: false, delete: false });
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStageFunnelId, setSelectedStageFunnelId] = useState<number | null>(null);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editingStatus, setEditingStatus] = useState<PipelineStatus | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    resource: 'schools' | 'rooms' | 'courses' | 'pipeline-statuses';
    id: number;
    name: string;
  } | null>(null);
  const [pipelineDeleteTarget, setPipelineDeleteTarget] = useState<{
    status: PipelineStatus;
    leadCount: number;
  } | null>(null);
  const [pipelineTransferTargetId, setPipelineTransferTargetId] = useState('');

  const configuration = useQuery<ConfigurationData>({
    queryKey: ['/api/academy/configuration'],
  });
  const groupsConfiguration = useQuery<GroupConfiguration>({
    queryKey: groupConfigurationKey,
    enabled: !isSalesSettingsMode && activeTab === 'groups',
  });
  const salesFunnels = useQuery<SalesFunnel[]>({
    queryKey: ['/api/academy/sales-funnels'],
    enabled: isSalesSettingsMode,
  });

  useEffect(() => {
    if (!isSalesSettingsMode && requestedTab === 'funnels') {
      navigate('/admin/sales-settings?tab=funnels', { replace: true });
      return;
    }
    setActiveTab(requestedTabValue);
  }, [isSalesSettingsMode, navigate, requestedTab, requestedTabValue]);

  useEffect(() => {
    const tabsList = tabsListRef.current;
    const activeTrigger = tabsListRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    if (!tabsList || !activeTrigger) return;
    tabsList.scrollLeft = activeTrigger.offsetLeft
      - (tabsList.clientWidth - activeTrigger.clientWidth) / 2;
  }, [activeTab, configuration.isLoading]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: groupConfigurationKey }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/configuration'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/marketing'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/teacher'] }),
    queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/administration'] }),
  ]);

  const handleTabChange = (nextTab: string) => {
    if (!availableTabs.includes(nextTab)) return;
    setActiveTab(nextTab);
    navigate(nextTab === defaultTab ? basePath : `${basePath}?tab=${nextTab}`);
  };

  // Schema factories resolve validation messages through the active language.
  const schoolSchemaMemo = useMemo(() => createSchoolSchema(t), [t]);
  const roomSchemaMemo = useMemo(() => createRoomSchema(t), [t]);
  const courseSchemaMemo = useMemo(() => createCourseSchema(t), [t]);
  const statusSchemaMemo = useMemo(() => createStatusSchema(t), [t]);

  const schoolForm = useForm<SchoolValues>({
    resolver: zodResolver(schoolSchemaMemo),
    defaultValues: {
      name: '',
      address: '',
      timezone: ACADEMY_TIME_ZONE,
      isActive: true,
    },
  });

  const roomForm = useForm<RoomValues>({
    resolver: zodResolver(roomSchemaMemo),
    defaultValues: {
      schoolId: '',
      name: '',
      capacity: 12,
      isActive: true,
    },
  });

  const courseForm = useForm<CourseValues>({
    resolver: zodResolver(courseSchemaMemo),
    defaultValues: {
      name: '',
      ageCategory: '',
      description: '',
      isActive: true,
      program: { version: 1, blocks: [] },
    },
  });

  const statusForm = useForm<StatusValues>({
    resolver: zodResolver(statusSchemaMemo),
    defaultValues: {
      name: '',
      color: '#2563eb',
      sortOrder: 10,
      isPipeline: true,
      isActive: true,
    },
  });

  const saveSchool = useMutation({
    mutationFn: (values: SchoolValues) => {
      return editingSchool
        ? apiRequest('PATCH', `/api/academy/schools/${editingSchool.id}`, values)
        : apiRequest('POST', '/api/academy/schools', values);
    },
    onSuccess: () => {
      toast({ title: editingSchool ? t('schoolUpdated') : t('schoolCreated') });
      setSchoolDialogOpen(false);
      setEditingSchool(null);
      schoolForm.reset();
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
    onSettled: () => { resourceSaveLocks.current.school = false; },
  });

  const saveRoom = useMutation({
    mutationFn: (values: RoomValues) => {
      const payload = {
        ...values,
        schoolId: Number(values.schoolId),
        capacity: Number(values.capacity),
      };
      return editingRoom
        ? apiRequest('PATCH', `/api/academy/rooms/${editingRoom.id}`, payload)
        : apiRequest('POST', '/api/academy/rooms', payload);
    },
    onSuccess: () => {
      toast({ title: editingRoom ? t('roomUpdated') : t('roomCreated') });
      setRoomDialogOpen(false);
      setEditingRoom(null);
      roomForm.reset();
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
    onSettled: () => { resourceSaveLocks.current.room = false; },
  });

  const saveCourse = useMutation({
    mutationFn: async (values: CourseValues) => {
      const { program, ...details } = values;
      const payload = {
        ...details,
        ...(editingCourse && !canEditCourseCurriculum(editingCourse.program) ? {} : { program }),
        slug: editingCourse?.slug ?? buildUniqueCourseSlug(
          values.name,
          configuration.data?.courses ?? [],
          editingCourse?.id,
        ),
      };
      return editingCourse
        ? apiRequest('PATCH', `/api/academy/courses/${editingCourse.id}/with-teachers`, payload)
        : apiRequest('POST', '/api/academy/courses/with-teachers', payload);
    },
    onSuccess: () => {
      toast({ title: editingCourse ? t('courseUpdated') : t('courseCreated') });
      setCourseDialogOpen(false);
      setEditingCourse(null);
      courseForm.reset();
      invalidate();
    },
    onError: (error: Error) => {
      void invalidate();
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const saveStatus = useMutation({
    mutationFn: (values: StatusValues) => {
      return editingStatus
        ? apiRequest('PATCH', `/api/academy/pipeline-statuses/${editingStatus.id}`, values)
        : apiRequest('POST', '/api/academy/pipeline-statuses', { ...values, funnelId: selectedStageFunnelId });
    },
    onSuccess: () => {
      toast({ title: editingStatus ? t('pipelineStageUpdated') : t('pipelineStageCreated') });
      setStatusDialogOpen(false);
      setEditingStatus(null);
      statusForm.reset();
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/pipeline-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
    onSettled: () => { resourceSaveLocks.current.status = false; },
  });

  // Closing any resource dialog with unsaved edits asks for confirmation
  // instead of silently discarding them.
  const schoolGuard = useUnsavedChangesGuard({
    open: schoolDialogOpen,
    isDirty: schoolForm.formState.isDirty,
    isPending: saveSchool.isPending,
    onOpenChange: (open) => {
      setSchoolDialogOpen(open);
      if (!open) setEditingSchool(null);
    },
  });
  const roomGuard = useUnsavedChangesGuard({
    open: roomDialogOpen,
    isDirty: roomForm.formState.isDirty,
    isPending: saveRoom.isPending,
    onOpenChange: (open) => {
      setRoomDialogOpen(open);
      if (!open) setEditingRoom(null);
    },
  });
  const courseGuard = useUnsavedChangesGuard({
    open: courseDialogOpen,
    isDirty: courseForm.formState.isDirty,
    isPending: saveCourse.isPending,
    onOpenChange: (open) => {
      setCourseDialogOpen(open);
      if (!open) {
        setEditingCourse(null);
        courseForm.reset();
      }
    },
  });
  const statusGuard = useUnsavedChangesGuard({
    open: statusDialogOpen,
    isDirty: statusForm.formState.isDirty,
    isPending: saveStatus.isPending,
    onOpenChange: (open) => {
      setStatusDialogOpen(open);
      if (!open) setEditingStatus(null);
    },
  });

  const deleteResource = useMutation({
    mutationFn: ({ resource, id }: NonNullable<typeof deleteTarget>) =>
      apiRequest('DELETE', `/api/academy/${resource}/${id}`),
    onSuccess: (_result, target) => {
      toast({
        title: t('resourceDeleted'),
      });
      setDeleteTarget(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/pipeline-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
    },
    onError: (error: Error & { rawMessage?: string }, target) => {
      if (target.resource === 'pipeline-statuses' && error.rawMessage === 'pipelineStageHasLeads') {
        const status = configuration.data?.statuses.find((item) => item.id === target.id);
        setDeleteTarget(null);
        if (status) {
          preparePipelineStatusDelete.mutate(status);
          return;
        }
      }

      toast({
        title: t('resourceNotDeleted'),
        description: error.message === 'resourceInUse' ? t('resourceInUse') : error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => { resourceSaveLocks.current.delete = false; },
  });

  const preparePipelineStatusDelete = useMutation({
    mutationFn: async (status: PipelineStatus) => {
      if (selectedStageFunnel?.initialStageCode === status.code) {
        throw new Error(t('pipelineInitialStageCannotBeDeleted'));
      }
      const usage = await apiRequest('GET', `/api/academy/pipeline-statuses/${status.id}/usage`);
      return {
        status,
        leadCount: Number(usage?.leadCount ?? 0),
      };
    },
    onSuccess: ({ status, leadCount }) => {
      if (leadCount <= 0) {
        setDeleteTarget({ resource: 'pipeline-statuses', id: status.id, name: status.name });
        return;
      }

      const defaultTarget = stagesForSalesFunnel(configuration.data?.statuses ?? [], undefined, selectedStageFunnel?.id)
        .filter((item) => item.id !== status.id && item.isActive !== false && item.isPipeline !== false)
        .sort((left, right) => left.sortOrder - right.sortOrder)[0];
      setPipelineDeleteTarget({ status, leadCount });
      setPipelineTransferTargetId(defaultTarget ? String(defaultTarget.id) : '');
    },
    onError: (error: Error) => toast({
      title: t('resourceNotDeleted'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const transferAndDeletePipelineStatus = useMutation({
    mutationFn: ({ status, targetStatusId }: { status: PipelineStatus; targetStatusId: string }) =>
      apiRequest('POST', `/api/academy/pipeline-statuses/${status.id}/transfer-leads-and-delete`, {
        targetStatusId: Number(targetStatusId),
      }),
    onSuccess: (result: { movedCount?: number }) => {
      toast({
        title: t('pipelineStageDeleted'),
        description: t('pipelineStageTransferCompleted')
          .replace('{count}', formatLeadCount(Number(result?.movedCount ?? 0), language, leadCountLabels)),
      });
      setPipelineDeleteTarget(null);
      setPipelineTransferTargetId('');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/pipeline-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/administration'] });
    },
    onError: (error: Error) => toast({
      title: t('resourceNotDeleted'),
      description: error.message,
      variant: 'destructive',
    }),
    onSettled: () => { resourceSaveLocks.current.stageTransfer = false; },
  });

  const updateStatusOrder = useMutation({
    mutationFn: async ({ status, direction }: { status: PipelineStatus; direction: -1 | 1 }) => {
      const allStatuses = [...(configuration.data?.statuses ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      );
      const index = funnelStatuses.findIndex((item) => item.id === status.id);
      const neighbor = funnelStatuses[index + direction];
      if (!neighbor || status.code === selectedStageFunnel?.initialStageCode || neighbor.code === selectedStageFunnel?.initialStageCode) return;
      const orderedStatusIds = allStatuses.map((item) => item.id);
      const fromIndex = orderedStatusIds.indexOf(status.id);
      const toIndex = orderedStatusIds.indexOf(neighbor.id);
      [orderedStatusIds[fromIndex], orderedStatusIds[toIndex]] = [orderedStatusIds[toIndex], orderedStatusIds[fromIndex]];
      await apiRequest('PUT', '/api/academy/pipeline-statuses/reorder', { orderedStatusIds });
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/pipeline-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
    },
    onError: (error: Error) => {
      void invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/pipeline-statuses'] });
      toast({ title: t('error'), description: error.message, variant: 'destructive' });
    },
  });
  const stageActionsPending = preparePipelineStatusDelete.isPending || updateStatusOrder.isPending;

  const openSchool = (school?: School) => {
    setEditingSchool(school ?? null);
    schoolForm.reset(school ? {
      name: school.name,
      address: school.address,
      timezone: school.timezone,
      isActive: school.isActive,
    } : {
      name: '',
      address: '',
      timezone: ACADEMY_TIME_ZONE,
      isActive: true,
    });
    setSchoolDialogOpen(true);
  };

  const openRoom = (room?: Room) => {
    setEditingRoom(room ?? null);
    roomForm.reset(room ? {
      schoolId: String(room.schoolId),
      name: room.name,
      capacity: room.capacity,
      isActive: room.isActive,
    } : {
      schoolId: '',
      name: '',
      capacity: 12,
      isActive: true,
    });
    setRoomDialogOpen(true);
  };

  const openCourse = (course?: Course) => {
    setEditingCourse(course ?? null);
    courseForm.reset(course ? {
      name: course.name,
      ageCategory: course.ageCategory,
      description: course.description ?? '',
      isActive: course.isActive,
      program: {
        version: 1,
        blocks: normalizeCourseCurriculum(course.program).blocks.map((block, index) => ({
          ...block, title: block.title || t('courseBlockNumber', { number: index + 1 }),
        })),
      },
    } : {
      name: '',
      ageCategory: '',
      description: '',
      isActive: true,
      program: { version: 1, blocks: [] },
    });
    setCourseDialogOpen(true);
  };

  const openStatus = (status?: PipelineStatus) => {
    if (!selectedStageFunnelId) return;
    setEditingStatus(status ?? null);
    statusForm.reset(status ? {
      name: status.name,
      color: status.color,
      sortOrder: status.sortOrder,
      isPipeline: status.isPipeline,
      isActive: status.isActive,
    } : {
      name: '',
      color: '#2563eb',
      sortOrder: (Math.max(0, ...funnelStatuses.map((item) => item.sortOrder)) + 10),
      isPipeline: true,
      isActive: true,
    });
    setStatusDialogOpen(true);
  };

  const schools = configuration.data?.schools ?? [];
  const rooms = configuration.data?.rooms ?? [];
  const courses = configuration.data?.courses ?? [];
  const statuses = useMemo(
    () => [...(configuration.data?.statuses ?? [])].sort((left, right) => left.sortOrder - right.sortOrder),
    [configuration.data?.statuses],
  );
  const selectedStageFunnel = salesFunnels.data?.find((funnel) => funnel.id === selectedStageFunnelId);
  const funnelStatuses = useMemo(
    () => selectedStageFunnel
      ? stagesForSalesFunnel(statuses, undefined, selectedStageFunnel.id)
      : [],
    [selectedStageFunnel, statuses],
  );
  const availableTransferStatuses = useMemo(
    () => pipelineDeleteTarget
      ? funnelStatuses.filter((status) => status.id !== pipelineDeleteTarget.status.id && status.isActive !== false && status.isPipeline !== false)
      : [],
    [pipelineDeleteTarget, funnelStatuses],
  );
  useEffect(() => {
    if (!pipelineDeleteTarget) return;
    if (availableTransferStatuses.some((status) => String(status.id) === pipelineTransferTargetId)) return;
    setPipelineTransferTargetId(availableTransferStatuses[0] ? String(availableTransferStatuses[0].id) : '');
  }, [availableTransferStatuses, pipelineDeleteTarget, pipelineTransferTargetId]);

  if (configuration.isLoading) {
    return (
      <ModulePage contained>
        <ModulePageBody contained ariaLabel={t('loading')}>
          <LoadingRegion className="flex flex-col gap-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-96 max-w-full" />
            <Skeleton className="h-[520px] w-full" />
          </LoadingRegion>
        </ModulePageBody>
      </ModulePage>
    );
  }

  if (configuration.isError || !configuration.data) {
    return (
      <ModulePage contained>
        <ModulePageBody contained ariaLabel={t('failedToLoadData')}>
          <Card>
            <CardHeader>
              <CardTitle>{t('failedToLoadData')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Button onClick={() => configuration.refetch()}>{t('retry')}</Button>
            </CardContent>
          </Card>
        </ModulePageBody>
      </ModulePage>
    );
  }

  return (
    <ModulePage contained>
      <PageHeader
        title={isSalesSettingsMode ? t('salesSettings') : t('academyConfiguration')}
      />

      <ModulePageBody contained ariaLabel={isSalesSettingsMode ? t('salesSettings') : t('academyConfiguration')}>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList
          ref={tabsListRef}
          indicator="underline"
          className="mb-5 h-auto w-full justify-start overflow-x-auto border-b border-border/70 p-0"
        >
          {isSalesSettingsMode ? (
            <>
              <TabsTrigger value="lead-assignment" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <UserRoundCheck />{t('leadAssignment')}
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <GitBranch />{t('pipelineStages')}
              </TabsTrigger>
              <TabsTrigger value="funnels" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <GitBranch />{t('salesFunnels')}
              </TabsTrigger>
              <TabsTrigger value="lead-merge" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <ArrowRightLeft />{t('leadMergeTab')}
              </TabsTrigger>
              <TabsTrigger value="kpi" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <Target />{t('kpiEmployeePlans')}
              </TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="schools" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <Building2 />{t('schools')}
              </TabsTrigger>
              <TabsTrigger value="rooms" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <DoorOpen />{t('rooms')}
              </TabsTrigger>
              <TabsTrigger value="courses" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <BookOpen />{t('courses')}
              </TabsTrigger>
              <TabsTrigger value="groups" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <UsersRound />{t('navGroups')}
              </TabsTrigger>
              <TabsTrigger value="contracts" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <FileSignature />{t('studentContractsTitle')}
              </TabsTrigger>
              <TabsTrigger value="access" className="gap-2 pb-2.5 data-[state=active]:text-primary">
                <UserRoundCheck />{t('academyAccessTab')}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="lead-assignment" className="mt-0">
          <div className="flex flex-col gap-5">
            <LeadDistributionPanel />
            <LeadAssignmentContent />
          </div>
        </TabsContent>

        {!isSalesSettingsMode && <TabsContent value="access" className="mt-0"><AcademyPortalAccess /></TabsContent>}
        {!isSalesSettingsMode && <TabsContent value="contracts" className="mt-0"><ContractsDirectory enabled={activeTab === 'contracts'} /></TabsContent>}

        <TabsContent value="schools" className="mt-0">
          <SchoolSettingsTable data={schools} archived={requestedFilter === 'archive'}
            onArchiveChange={(archived) => navigate(archived ? `${basePath}?tab=schools&filter=archive` : basePath)}
            onAdd={() => openSchool()} onEdit={openSchool} onChanged={invalidate}
            onDelete={(row) => setDeleteTarget({ resource: 'schools', id: row.id, name: row.name })} />
        </TabsContent>

        <TabsContent value="rooms" className="mt-0">
          <RoomSettingsTable data={rooms} schools={schools} archived={requestedFilter === 'archive'}
            onArchiveChange={(archived) => navigate(`${basePath}?tab=rooms${archived ? '&filter=archive' : ''}`)}
            onAdd={() => openRoom()} onEdit={openRoom} onChanged={invalidate}
            onDelete={(row) => setDeleteTarget({ resource: 'rooms', id: row.id, name: row.name })} />
        </TabsContent>

        <TabsContent value="courses" className="mt-0">
          <CourseSettingsTable data={courses} archived={requestedFilter === 'archive'}
            onArchiveChange={(archived) => navigate(`${basePath}?tab=courses${archived ? '&filter=archive' : ''}`)}
            onAdd={() => openCourse()} onEdit={openCourse} onChanged={invalidate}
            onDelete={(row) => setDeleteTarget({ resource: 'courses', id: row.id, name: row.name })} />
        </TabsContent>

        <TabsContent value="groups" className="mt-0">
          {groupsConfiguration.isPending ? <LoadingRegion role="status" aria-label={t('loading')} className="space-y-4">
            <Skeleton className="h-44 w-full" /><Skeleton className="h-96 w-full" />
          </LoadingRegion> : groupsConfiguration.isError || !groupsConfiguration.data ? <Card>
            <CardHeader><CardTitle>{t('failedToLoadData')}</CardTitle></CardHeader>
            <CardContent><Button onClick={() => void groupsConfiguration.refetch()}>{t('retry')}</Button></CardContent>
          </Card> : <GroupsWorkspace configuration={groupsConfiguration.data} basePath={`${basePath}?tab=groups`} scopeControl="select" />}
        </TabsContent>

        <TabsContent value="funnels" className="mt-0">
          <SalesFunnelsPanel />
        </TabsContent>

        <TabsContent value="pipeline" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>{t('pipelineStages')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(salesFunnels.data ?? []).map((funnel) => (
                <button
                  key={funnel.id}
                  type="button"
                  className="flex min-h-20 items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedStageFunnelId(funnel.id)}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{funnel.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t('pipelineFunnelStageCount').replace('{count}', String(stagesForSalesFunnel(statuses, undefined, funnel.id).length))}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {salesFunnels.isLoading ? <LoadingRegion className="inline-block align-middle"><Skeleton className="h-20" /></LoadingRegion> : null}
              {!salesFunnels.isLoading && salesFunnels.data?.length === 0 ? (
                <EmptyTableState title={t('noSalesFunnels')}  />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lead-merge" className="mt-0">
          <LeadMergePanel />
        </TabsContent>

        <TabsContent value="kpi" className="mt-0">
          <KpiSettingsPanel />
        </TabsContent>

      </Tabs>
      </ModulePageBody>

      <Dialog open={Boolean(selectedStageFunnel)} onOpenChange={(open) => {
        if (!open && !stageActionsPending) setSelectedStageFunnelId(null);
      }}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle className="text-base leading-6">{selectedStageFunnel?.name}</DialogTitle>
          </DialogHeader>
          <div className="compact-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <CompactModalSection
              title={t('pipelineStages')}
              icon={GitBranch}
              tone="violet"
              count={funnelStatuses.length}
              collapsible={false}
              sectionId="funnel-stages"
              contentClassName="divide-y divide-border/70 p-0"
              actions={<Button size="sm" disabled={stageActionsPending} onClick={() => openStatus()}><Plus data-icon="inline-start" />{t('addPipelineStage')}</Button>}
            >
              {funnelStatuses.map((status, index) => (
                <div key={status.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-foreground">{status.name}</p>
                      {selectedStageFunnel?.initialStageCode === status.code ? (
                        <Badge variant="secondary" className="mt-0.5 text-[10px]">{t('salesFunnelInitialStage')}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:w-auto">
                    <Badge variant={status.isPipeline ? 'default' : 'secondary'} className="text-[10px]">
                      {status.isPipeline ? t('shownInPipeline') : t('hiddenFromPipeline')}
                    </Badge>
                    <Badge variant={status.isActive ? 'outline' : 'secondary'} className="text-[10px]">
                      {status.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-8" disabled={stageActionsPending} onClick={() => openStatus(status)}>
                      <Edit3 />
                      <span className="sr-only">{t('edit')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={stageActionsPending || selectedStageFunnel?.initialStageCode === status.code}
                      onClick={() => preparePipelineStatusDelete.mutate(status)}
                    >
                      <Trash2 />
                      <span className="sr-only">{t('delete')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index <= 1 || stageActionsPending}
                      onClick={() => updateStatusOrder.mutate({ status, direction: -1 })}
                    >
                      <ArrowUp />
                      <span className="sr-only">{t('moveUp')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === 0 || index === funnelStatuses.length - 1 || stageActionsPending}
                      onClick={() => updateStatusOrder.mutate({ status, direction: 1 })}
                    >
                      <ArrowDown />
                      <span className="sr-only">{t('moveDown')}</span>
                    </Button>
                  </div>
                </div>
              ))}
              {funnelStatuses.length === 0 ? (
                <EmptyTableState title={t('noPipelineStages')}  />
              ) : null}
            </CompactModalSection>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={schoolDialogOpen} onOpenChange={schoolGuard.handleOpenChange}>
        <DialogContent onEscapeKeyDown={event => { if (schoolTimezonePopupRef.current) event.preventDefault(); }} aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle className="text-base leading-6">{editingSchool ? t('editSchool') : t('addSchool')}</DialogTitle>
          </DialogHeader>
          <Form {...schoolForm}>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={schoolForm.handleSubmit((values) => {
              if (resourceSaveLocks.current.school) return;
              resourceSaveLocks.current.school = true;
              saveSchool.mutate(values);
            })}>
              <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
                <CompactModalSection title={t('academyResourceDetails')} icon={Building2} tone="sky" collapsible={false} disabled={saveSchool.isPending} sectionId="school-details" contentClassName="grid gap-3 sm:grid-cols-2">
                  <FormField control={schoolForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('schoolName')}</FormLabel>
                      <FormControl><Input {...field} disabled={saveSchool.isPending} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={schoolForm.control} name="address" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('address')}</FormLabel>
                      <FormControl><Input {...field} disabled={saveSchool.isPending} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={schoolForm.control} name="timezone" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel required>{t('timezone')}</FormLabel>
                      <FormControl><TimezoneSelect {...field} disabled={saveSchool.isPending} onPopupOpenChange={open => { schoolTimezonePopupRef.current = open; }} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                </CompactModalSection>
                <CompactModalSection title={t('status')} tone="teal" collapsible={false} disabled={saveSchool.isPending} sectionId="school-status">
                  <FormField control={schoolForm.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0">
                      <FormLabel>{t('activeSchool')}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={saveSchool.isPending} /></FormControl>
                    </FormItem>
                  )} />
                </CompactModalSection>
              </div>
              <DialogFooter className="compact-modal-footer">
                <Button type="button" variant="outline" disabled={saveSchool.isPending} onClick={() => schoolGuard.handleOpenChange(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={saveSchool.isPending}>
                  {saveSchool.isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : null}
                  {saveSchool.isPending ? t('saving') : t('save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={roomDialogOpen} onOpenChange={roomGuard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle className="text-base leading-6">{editingRoom ? t('editRoom') : t('addRoom')}</DialogTitle>
          </DialogHeader>
          <Form {...roomForm}>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={roomForm.handleSubmit((values) => {
              if (resourceSaveLocks.current.room) return;
              resourceSaveLocks.current.room = true;
              saveRoom.mutate(values);
            })}>
              <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
                <CompactModalSection title={t('academyResourceDetails')} icon={DoorOpen} tone="sky" collapsible={false} disabled={saveRoom.isPending} sectionId="room-details" contentClassName="grid gap-3 sm:grid-cols-2">
                  <FormField control={roomForm.control} name="schoolId" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('school')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={saveRoom.isPending}>
                        <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('selectSchool')} /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {schools.filter((school) => school.isActive !== false).map((school) => (
                              <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={roomForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('roomName')}</FormLabel>
                      <FormControl><Input {...field} disabled={saveRoom.isPending} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={roomForm.control} name="capacity" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('roomCapacity')}</FormLabel>
                      <FormControl><QuantityStepper min="1" {...field} disabled={saveRoom.isPending} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                </CompactModalSection>
                <CompactModalSection title={t('status')} tone="teal" collapsible={false} disabled={saveRoom.isPending} sectionId="room-status">
                  <FormField control={roomForm.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0">
                      <FormLabel>{t('active')}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={saveRoom.isPending} /></FormControl>
                    </FormItem>
                  )} />
                </CompactModalSection>
              </div>
              <DialogFooter className="compact-modal-footer">
                <Button type="button" variant="outline" disabled={saveRoom.isPending} onClick={() => roomGuard.handleOpenChange(false)}>{t('cancel')}</Button>
                <Button loading={saveRoom.isPending} type="submit" disabled={saveRoom.isPending}>{saveRoom.isPending ? t('saving') : t('save')}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <CourseEditorDialog
        open={courseDialogOpen}
        onOpenChange={courseGuard.handleOpenChange}
        form={courseForm}
        editing={editingCourse !== null}
        saving={saveCourse.isPending}
        curriculumUnavailable={editingCourse !== null && !canEditCourseCurriculum(editingCourse.program)}
        onSubmit={(values) => saveCourse.mutate(values)}
      />

      <Dialog open={statusDialogOpen} onOpenChange={statusGuard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle className="text-base leading-6">{editingStatus ? t('editPipelineStage') : t('addPipelineStage')}</DialogTitle>
          </DialogHeader>
          <Form {...statusForm}>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={statusForm.handleSubmit((values) => {
              if (resourceSaveLocks.current.status) return;
              resourceSaveLocks.current.status = true;
              saveStatus.mutate(values);
            })}>
              <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
                <CompactModalSection title={t('academyResourceDetails')} icon={Target} tone="sky" collapsible={false} disabled={saveStatus.isPending} sectionId="stage-details" contentClassName="grid gap-3 sm:grid-cols-2">
                  <FormField control={statusForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('name')}</FormLabel>
                      <FormControl><Input {...field} disabled={saveStatus.isPending} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={statusForm.control} name="color" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('color')}</FormLabel>
                      <div className="flex gap-2">
                        <FormControl><Input type="color" className="w-12 shrink-0 p-1" {...field} disabled={saveStatus.isPending} /></FormControl>
                        <Input aria-label={t('color')} value={field.value} onChange={field.onChange} disabled={saveStatus.isPending} />
                      </div>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                  <FormField control={statusForm.control} name="sortOrder" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('sortOrder')}</FormLabel>
                      <FormControl><Input type="number" min="0" step="10" {...field} disabled={saveStatus.isPending || selectedStageFunnel?.initialStageCode === editingStatus?.code} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )} />
                </CompactModalSection>
                <CompactModalSection title={t('status')} tone="violet" collapsible={false} disabled={saveStatus.isPending} sectionId="stage-status" contentClassName="grid gap-3 sm:grid-cols-2">
                  <FormField control={statusForm.control} name="isPipeline" render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0">
                      <FormLabel>{t('shownInPipeline')}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={saveStatus.isPending || selectedStageFunnel?.initialStageCode === editingStatus?.code} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={statusForm.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0">
                      <FormLabel>{t('active')}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={saveStatus.isPending || selectedStageFunnel?.initialStageCode === editingStatus?.code} /></FormControl>
                    </FormItem>
                  )} />
                </CompactModalSection>
              </div>
              <DialogFooter className="compact-modal-footer">
                <Button type="button" variant="outline" disabled={saveStatus.isPending} onClick={() => statusGuard.handleOpenChange(false)}>{t('cancel')}</Button>
                <Button
                  type="submit"
                  disabled={saveStatus.isPending}
                >
                  {saveStatus.isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : null}
                  {saveStatus.isPending ? t('saving') : t('save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pipelineDeleteTarget)}
        onOpenChange={(open) => {
          if (open || transferAndDeletePipelineStatus.isPending) return;
          setPipelineDeleteTarget(null);
          setPipelineTransferTargetId('');
        }}
        pending={transferAndDeletePipelineStatus.isPending}
      >
        <AlertDialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col overflow-hidden p-0">
          <AlertDialogHeader data-topographic="header" className="compact-modal-header">
            <AlertDialogTitle className="text-base leading-6">{t('pipelineStageDeleteTransferTitle')}</AlertDialogTitle>
          </AlertDialogHeader>

          {pipelineDeleteTarget ? (
            <>
              <AlertDialogBody>
                <AlertDialogDescription>
                  {t('pipelineStageDeleteTransferDescription').replace('{stage}', pipelineDeleteTarget.status.name)}
                </AlertDialogDescription>
                <CompactModalSection title={t('transferLeadsToStage')} icon={ArrowRightLeft} tone="amber" collapsible={false} disabled={transferAndDeletePipelineStatus.isPending} sectionId="stage-transfer" contentClassName="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('currentStage')}</Label>
                    <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: pipelineDeleteTarget.status.color }}
                      />
                      <span className="font-medium [overflow-wrap:anywhere]">{pipelineDeleteTarget.status.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatLeadCount(pipelineDeleteTarget.leadCount, language, leadCountLabels)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pipeline-transfer-target">{t('transferLeadsToStage')}</Label>
                    <Select
                      value={pipelineTransferTargetId}
                      onValueChange={setPipelineTransferTargetId}
                      disabled={availableTransferStatuses.length === 0 || transferAndDeletePipelineStatus.isPending}
                    >
                      <SelectTrigger id="pipeline-transfer-target">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {availableTransferStatuses.map((status) => (
                            <SelectItem key={status.id} value={String(status.id)}>
                              <span className="inline-flex min-w-0 items-center gap-2">
                                <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                                <span className="truncate">{status.name}</span>
                                {!status.isPipeline ? (
                                  <span className="text-xs text-muted-foreground">({t('hiddenFromPipeline')})</span>
                                ) : null}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {availableTransferStatuses.length === 0 ? (
                      <p className="text-xs text-destructive">{t('pipelineStageNoAvailableTargets')}</p>
                    ) : null}
                  </div>
                </CompactModalSection>

              </AlertDialogBody>

              <AlertDialogFooter className="compact-modal-footer">
                <AlertDialogCancel
                  disabled={transferAndDeletePipelineStatus.isPending}
                >
                  {t('cancel')}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={!availableTransferStatuses.some(status => String(status.id) === pipelineTransferTargetId) || transferAndDeletePipelineStatus.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    if (resourceSaveLocks.current.stageTransfer || !availableTransferStatuses.some(status => String(status.id) === pipelineTransferTargetId)) return;
                    resourceSaveLocks.current.stageTransfer = true;
                    transferAndDeletePipelineStatus.mutate({
                      status: pipelineDeleteTarget.status,
                      targetStatusId: pipelineTransferTargetId,
                    });
                  }}
                >{(transferAndDeletePipelineStatus.isPending) && <OrbitSpinner className="mr-1.5 size-4" />}
                  <ArrowRightLeft data-icon="inline-start" />
                  {transferAndDeletePipelineStatus.isPending ? t('saving') : t('transferLeadsAndDeleteStage')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        compact
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleteResource.isPending) setDeleteTarget(null);
        }}
        title={t('confirmDeleteResource')}
        description={deleteTarget
          ? `${t('deleteResourceDescription')} “${deleteTarget.name}”?`
          : ''}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={deleteResource.isPending}
        keepOpenOnConfirm
        onConfirm={() => {
          if (!deleteTarget || resourceSaveLocks.current.delete) return;
          resourceSaveLocks.current.delete = true;
          deleteResource.mutate(deleteTarget);
        }}
      />

      <UnsavedChangesDialog
        open={schoolGuard.confirmationOpen}
        onOpenChange={schoolGuard.setConfirmationOpen}
        onDiscard={schoolGuard.discardChanges}
      />
      <UnsavedChangesDialog
        open={roomGuard.confirmationOpen}
        onOpenChange={roomGuard.setConfirmationOpen}
        onDiscard={roomGuard.discardChanges}
      />
      <UnsavedChangesDialog
        open={courseGuard.confirmationOpen}
        onOpenChange={courseGuard.setConfirmationOpen}
        onDiscard={courseGuard.discardChanges}
      />
      <UnsavedChangesDialog
        open={statusGuard.confirmationOpen}
        onOpenChange={statusGuard.setConfirmationOpen}
        onDiscard={statusGuard.discardChanges}
      />
    </ModulePage>
  );
}
