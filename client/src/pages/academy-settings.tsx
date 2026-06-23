import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useSearch } from 'wouter';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
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
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { AdminScheduleCalendar } from '@/components/ux/AdminScheduleCalendar';
import {
  WeekScheduleEditor,
  type WeekScheduleItem,
} from '@/components/ux/WeekScheduleEditor';
import { getGroupScheduleValidationError } from '@shared/scheduling';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Building2,
  DoorOpen,
  Edit3,
  GitBranch,
  MapPin,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';

interface School {
  id: number;
  name: string;
  code: string;
  address: string;
  timezone: string;
  isActive: boolean;
}

interface Room {
  id: number;
  schoolId: number;
  name: string;
  capacity: number;
  isActive: boolean;
}

interface Course {
  id: number;
  name: string;
  slug: string;
  ageCategory: string;
  lessonCount: number;
  lessonDurationMinutes: number;
  durationDays: number;
  description?: string | null;
  frequency?: string | null;
  basePriceUzs: number;
  isActive: boolean;
}

interface PipelineStatus {
  id: number;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  isPipeline: boolean;
  isSystem: boolean;
  isActive: boolean;
}

interface Teacher {
  id: number;
  fullName: string;
  courseIds: number[];
  schoolIds: number[];
  availability: WeekScheduleItem[];
  status: string;
}

interface Group {
  id: number;
  name: string;
  courseId: number;
  courseName?: string;
  schoolId: number;
  schoolName?: string;
  roomId: number;
  roomName?: string;
  teacherId?: number | null;
  teacherName?: string | null;
  schedule: WeekScheduleItem[];
  maxStudents: number;
  currentStudents: number;
  reservedStudents: number;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
}

interface ConfigurationData {
  schools: School[];
  rooms: Room[];
  courses: Course[];
  statuses: PipelineStatus[];
  teachers: Teacher[];
  groups: Group[];
}

const schoolSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1).regex(/^[a-z0-9_-]+$/),
  address: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  isActive: z.boolean(),
});

const roomSchema = z.object({
  schoolId: z.string().min(1),
  name: z.string().trim().min(1),
  capacity: z.coerce.number().int().min(1),
  isActive: z.boolean(),
});

const courseSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/),
  ageCategory: z.string().trim().min(1),
  lessonCount: z.coerce.number().int().min(1),
  lessonDurationMinutes: z.coerce.number().int().min(15),
  durationDays: z.coerce.number().int().min(1),
  frequency: z.string(),
  description: z.string(),
  basePriceUzs: z.coerce.number().int().min(0),
  isActive: z.boolean(),
});

const statusSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1).regex(/^[a-z0-9_]+$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.coerce.number().int().min(0),
  isPipeline: z.boolean(),
  isActive: z.boolean(),
});

const groupSchema = z.object({
  name: z.string().trim().min(1),
  courseId: z.string().min(1),
  schoolId: z.string().min(1),
  roomId: z.string().min(1),
  status: z.enum(['open', 'in_progress', 'completed']),
  startDate: z.string(),
  endDate: z.string(),
}).superRefine((values, context) => {
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
    });
  }
});

type SchoolValues = z.infer<typeof schoolSchema>;
type RoomValues = z.infer<typeof roomSchema>;
type CourseValues = z.infer<typeof courseSchema>;
type StatusValues = z.infer<typeof statusSchema>;
type GroupValues = z.infer<typeof groupSchema>;

const normalizeSchedule = (items: unknown): WeekScheduleItem[] => {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: any) => {
    const dayOfWeek = Number(item?.dayOfWeek);
    const startTime = String(item?.startTime ?? item?.time ?? '');
    const endTime = String(item?.endTime ?? item?.time ?? '');
    if (!dayOfWeek || !startTime) return [];
    return [{
      dayOfWeek,
      startTime,
      endTime: endTime || startTime,
      schoolId: item?.schoolId ? Number(item.schoolId) : null,
    }];
  });
};

const toDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const transliterationMap: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const slugify = (value: string) => value
  .trim()
  .toLowerCase()
  .split('')
  .map((character) => transliterationMap[character] ?? character)
  .join('')
  .replace(/[^a-z0-9а-яё]+/gi, '-')
  .replace(/[^a-z0-9-]+/g, '')
  .replace(/^-+|-+$/g, '');

function EmptyTableState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
        <Building2 className="text-muted-foreground" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function AcademySettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const routeSearch = useSearch();
  const requestedTab = new URLSearchParams(routeSearch).get('tab');
  const [activeTab, setActiveTab] = useState(
    ['schools', 'rooms', 'courses', 'groups', 'schedule', 'pipeline'].includes(String(requestedTab))
      ? String(requestedTab)
      : 'schools',
  );
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editingStatus, setEditingStatus] = useState<PipelineStatus | null>(null);
  const [groupSchedule, setGroupSchedule] = useState<WeekScheduleItem[]>([]);
  const [courseTeacherIds, setCourseTeacherIds] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{
    resource: 'schools' | 'rooms' | 'courses' | 'groups' | 'pipeline-statuses';
    id: number;
    name: string;
  } | null>(null);

  const configuration = useQuery<ConfigurationData>({
    queryKey: ['/api/academy/configuration'],
  });

  const invalidate = () => queryClient.invalidateQueries({
    queryKey: ['/api/academy/configuration'],
  });

  const dayNames = [
    t('monday'),
    t('tuesday'),
    t('wednesday'),
    t('thursday'),
    t('friday'),
    t('saturday'),
    t('sunday'),
  ];

  const schoolForm = useForm<SchoolValues>({
    resolver: zodResolver(schoolSchema),
    defaultValues: {
      name: '',
      code: '',
      address: '',
      timezone: 'Asia/Tashkent',
      isActive: true,
    },
  });

  const roomForm = useForm<RoomValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: {
      schoolId: '',
      name: '',
      capacity: 12,
      isActive: true,
    },
  });

  const courseForm = useForm<CourseValues>({
    resolver: zodResolver(courseSchema),
    defaultValues: {
      name: '',
      slug: '',
      ageCategory: '',
      lessonCount: 10,
      lessonDurationMinutes: 120,
      durationDays: 30,
      frequency: '',
      description: '',
      basePriceUzs: 0,
      isActive: true,
    },
  });

  const statusForm = useForm<StatusValues>({
    resolver: zodResolver(statusSchema),
    defaultValues: {
      name: '',
      code: '',
      color: '#2563eb',
      sortOrder: 10,
      isPipeline: true,
      isActive: true,
    },
  });

  const groupForm = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: '',
      courseId: '',
      schoolId: '',
      roomId: '',
      status: 'open',
      startDate: '',
      endDate: '',
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
  });

  const saveCourse = useMutation({
    mutationFn: async (values: CourseValues) => {
      const course = editingCourse
        ? await apiRequest('PATCH', `/api/academy/courses/${editingCourse.id}`, values)
        : await apiRequest('POST', '/api/academy/courses', values);

      const courseId = Number(course.id);
      const teachers = configuration.data?.teachers ?? [];
      await Promise.all(teachers.map((teacher) => {
        const ids = new Set((teacher.courseIds ?? []).map(Number));
        if (courseTeacherIds.includes(teacher.id)) ids.add(courseId);
        else ids.delete(courseId);
        const nextIds = [...ids].sort((left, right) => left - right);
        const currentIds = [...(teacher.courseIds ?? [])].map(Number).sort((left, right) => left - right);
        if (JSON.stringify(nextIds) === JSON.stringify(currentIds)) return Promise.resolve();
        return apiRequest('PATCH', `/api/academy/teachers/${teacher.id}`, { courseIds: nextIds });
      }));
      return course;
    },
    onSuccess: () => {
      toast({ title: editingCourse ? t('courseUpdated') : t('courseCreated') });
      setCourseDialogOpen(false);
      setEditingCourse(null);
      setCourseTeacherIds([]);
      courseForm.reset();
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const saveGroup = useMutation({
    mutationFn: (values: GroupValues) => {
      const payload = {
        name: values.name,
        courseId: Number(values.courseId),
        schoolId: Number(values.schoolId),
        roomId: Number(values.roomId),
        schedule: groupSchedule,
        maxStudents: 12,
        status: values.status,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        autoAssign: true,
      };
      return editingGroup
        ? apiRequest('PATCH', `/api/academy/groups/${editingGroup.id}`, payload)
        : apiRequest('POST', '/api/academy/groups', payload);
    },
    onSuccess: (group: Group) => {
      const teacher = configuration.data?.teachers.find(
        (item) => item.id === Number(group.teacherId),
      );
      toast({
        title: editingGroup ? t('groupUpdated') : t('groupCreated'),
        description: teacher?.fullName ?? t('teacherAssignmentPendingDescription'),
      });
      setGroupDialogOpen(false);
      setEditingGroup(null);
      setGroupSchedule([]);
      groupForm.reset();
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const saveStatus = useMutation({
    mutationFn: (values: StatusValues) => {
      const payload = { ...values, isSystem: editingStatus?.isSystem ?? false };
      return editingStatus
        ? apiRequest('PATCH', `/api/academy/pipeline-statuses/${editingStatus.id}`, payload)
        : apiRequest('POST', '/api/academy/pipeline-statuses', payload);
    },
    onSuccess: () => {
      toast({ title: editingStatus ? t('pipelineStageUpdated') : t('pipelineStageCreated') });
      setStatusDialogOpen(false);
      setEditingStatus(null);
      statusForm.reset();
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const deleteResource = useMutation({
    mutationFn: ({ resource, id }: NonNullable<typeof deleteTarget>) =>
      apiRequest('DELETE', `/api/academy/${resource}/${id}`),
    onSuccess: () => {
      toast({ title: t('resourceDeleted') });
      setDeleteTarget(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
    onError: (error: Error) => toast({
      title: t('resourceNotDeleted'),
      description: error.message === 'resourceInUse' ? t('resourceInUse') : error.message,
      variant: 'destructive',
    }),
  });

  const updateStatusOrder = useMutation({
    mutationFn: async ({ status, direction }: { status: PipelineStatus; direction: -1 | 1 }) => {
      const statuses = [...(configuration.data?.statuses ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      );
      const index = statuses.findIndex((item) => item.id === status.id);
      const neighbor = statuses[index + direction];
      if (!neighbor) return;
      await Promise.all([
        apiRequest('PATCH', `/api/academy/pipeline-statuses/${status.id}`, {
          sortOrder: neighbor.sortOrder,
        }),
        apiRequest('PATCH', `/api/academy/pipeline-statuses/${neighbor.id}`, {
          sortOrder: status.sortOrder,
        }),
      ]);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
  });

  const openSchool = (school?: School) => {
    setEditingSchool(school ?? null);
    schoolForm.reset(school ? {
      name: school.name,
      code: school.code,
      address: school.address,
      timezone: school.timezone,
      isActive: school.isActive,
    } : {
      name: '',
      code: '',
      address: '',
      timezone: 'Asia/Tashkent',
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
      slug: course.slug,
      ageCategory: course.ageCategory,
      lessonCount: course.lessonCount,
      lessonDurationMinutes: course.lessonDurationMinutes,
      durationDays: course.durationDays || 1,
      frequency: course.frequency ?? '',
      description: course.description ?? '',
      basePriceUzs: course.basePriceUzs ?? 0,
      isActive: course.isActive,
    } : {
      name: '',
      slug: '',
      ageCategory: '',
      lessonCount: 10,
      lessonDurationMinutes: 120,
      durationDays: 30,
      frequency: '',
      description: '',
      basePriceUzs: 0,
      isActive: true,
    });
    setCourseTeacherIds((configuration.data?.teachers ?? [])
      .filter((teacher) => course?.id && (teacher.courseIds ?? []).map(Number).includes(course.id))
      .map((teacher) => teacher.id));
    setCourseDialogOpen(true);
  };

  const openGroup = (group?: Group) => {
    setEditingGroup(group ?? null);
    groupForm.reset(group ? {
      name: group.name,
      courseId: String(group.courseId),
      schoolId: String(group.schoolId),
      roomId: String(group.roomId),
      status: ['open', 'in_progress', 'completed'].includes(group.status)
        ? group.status as GroupValues['status']
        : 'open',
      startDate: toDateInput(group.startDate),
      endDate: toDateInput(group.endDate),
    } : {
      name: '',
      courseId: '',
      schoolId: '',
      roomId: '',
      status: 'open',
      startDate: '',
      endDate: '',
    });
    setGroupSchedule(normalizeSchedule(group?.schedule));
    setGroupDialogOpen(true);
  };

  const openStatus = (status?: PipelineStatus) => {
    setEditingStatus(status ?? null);
    statusForm.reset(status ? {
      name: status.name,
      code: status.code,
      color: status.color,
      sortOrder: status.sortOrder,
      isPipeline: status.isPipeline,
      isActive: status.isActive,
    } : {
      name: '',
      code: '',
      color: '#2563eb',
      sortOrder: ((configuration.data?.statuses.length ?? 0) + 1) * 10,
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
  const teachers = configuration.data?.teachers ?? [];
  const groups = configuration.data?.groups ?? [];
  const selectedGroupSchoolId = groupForm.watch('schoolId');
  const groupRooms = useMemo(
    () => rooms.filter((room) => (
      room.isActive !== false && String(room.schoolId) === selectedGroupSchoolId
    )),
    [rooms, selectedGroupSchoolId],
  );
  const schoolNameById = useMemo(
    () => new Map(schools.map((school) => [school.id, school.name])),
    [schools],
  );

  const schoolColumns: DataTableColumn<School>[] = [
    {
      key: 'name',
      header: t('school'),
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    {
      key: 'address',
      header: t('address'),
      sortable: true,
      accessor: (row) => row.address,
      render: (row) => (
        <div className="flex max-w-md items-center gap-2">
          <MapPin className="shrink-0 text-muted-foreground" />
          <span className="truncate">{row.address}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      accessor: (row) => row.isActive ? 1 : 0,
      render: (row) => <Badge variant={row.isActive ? 'default' : 'secondary'}>{row.isActive ? t('active') : t('inactive')}</Badge>,
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openSchool(row)}>
            <Edit3 />
            <span className="sr-only">{t('edit')}</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ resource: 'schools', id: row.id, name: row.name })}>
            <Trash2 />
            <span className="sr-only">{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ];

  const roomColumns: DataTableColumn<Room>[] = [
    {
      key: 'name',
      header: t('room'),
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => <div className="flex items-center gap-2 font-medium text-foreground"><DoorOpen />{row.name}</div>,
    },
    {
      key: 'school',
      header: t('school'),
      sortable: true,
      accessor: (row) => schoolNameById.get(row.schoolId) ?? '',
      render: (row) => <span className="text-muted-foreground">{schoolNameById.get(row.schoolId) ?? '—'}</span>,
    },
    {
      key: 'capacity',
      header: t('roomCapacity'),
      sortable: true,
      accessor: (row) => row.capacity,
      render: (row) => `${row.capacity} ${t('students')}`,
    },
    {
      key: 'status',
      header: t('status'),
      accessor: (row) => row.isActive ? 1 : 0,
      render: (row) => <Badge variant={row.isActive ? 'default' : 'secondary'}>{row.isActive ? t('active') : t('inactive')}</Badge>,
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openRoom(row)}>
            <Edit3 />
            <span className="sr-only">{t('edit')}</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ resource: 'rooms', id: row.id, name: row.name })}>
            <Trash2 />
            <span className="sr-only">{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ];

  const courseColumns: DataTableColumn<Course>[] = [
    {
      key: 'name',
      header: t('course'),
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.ageCategory}</p>
        </div>
      ),
    },
    {
      key: 'lessonCount',
      header: t('lessonsCount'),
      sortable: true,
      accessor: (row) => row.lessonCount,
    },
    {
      key: 'lessonDurationMinutes',
      header: t('lessonDuration'),
      sortable: true,
      accessor: (row) => row.lessonDurationMinutes,
      render: (row) => `${row.lessonDurationMinutes} ${t('minuteShort')}`,
    },
    {
      key: 'durationDays',
      header: t('courseDurationDays'),
      sortable: true,
      accessor: (row) => row.durationDays,
      render: (row) => `${row.durationDays} ${t('dayShort')}`,
    },
    {
      key: 'status',
      header: t('status'),
      accessor: (row) => row.isActive ? 1 : 0,
      render: (row) => <Badge variant={row.isActive ? 'default' : 'secondary'}>{row.isActive ? t('active') : t('inactive')}</Badge>,
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openCourse(row)}>
            <Edit3 />
            <span className="sr-only">{t('edit')}</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ resource: 'courses', id: row.id, name: row.name })}>
            <Trash2 />
            <span className="sr-only">{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ];

  const groupColumns: DataTableColumn<Group>[] = [
    {
      key: 'name',
      header: t('group'),
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.teacherName ?? t('teacherWillBeAssigned')}
          </p>
        </div>
      ),
    },
    {
      key: 'courseAndSchool',
      header: t('courseAndSchool'),
      sortable: true,
      accessor: (row) => `${row.courseName ?? ''} ${row.schoolName ?? ''}`,
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.courseName ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{row.schoolName ?? '—'} · {row.roomName ?? t('roomNotFound')}</p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: t('schedule'),
      accessor: (row) => row.schedule?.length ?? 0,
      render: (row) => (
        <div className="flex max-w-md flex-wrap gap-1">
          {normalizeSchedule(row.schedule).slice(0, 3).map((item, index) => (
            <Badge key={`${row.id}-${item.dayOfWeek}-${item.startTime}-${index}`} variant="outline">
              {dayNames[item.dayOfWeek - 1]} {item.startTime}–{item.endTime}
            </Badge>
          ))}
          {(row.schedule?.length ?? 0) > 3
            ? <Badge variant="secondary">+{row.schedule.length - 3}</Badge>
            : null}
        </div>
      ),
    },
    {
      key: 'capacity',
      header: t('groupCapacity'),
      sortable: true,
      accessor: (row) => Number(row.currentStudents || 0) + Number(row.reservedStudents || 0),
      render: (row) => {
        const occupied = Number(row.currentStudents || 0) + Number(row.reservedStudents || 0);
        return (
          <div className="flex min-w-36 flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{occupied}/{row.maxStudents || 12}</span>
              {Number(row.reservedStudents || 0) > 0
                ? <span className="text-muted-foreground">{t('reservedSeats')}: {row.reservedStudents}</span>
                : null}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, (occupied / Math.max(1, row.maxStudents || 12)) * 100)}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (row) => row.status,
      render: (row) => (
        <Badge variant={row.status === 'completed' ? 'secondary' : 'outline'}>
          {row.status === 'open'
            ? t('groupStatusOpen')
            : row.status === 'in_progress'
              ? t('groupStatusInProgress')
              : t('groupStatusCompleted')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openGroup(row)}>
            <Edit3 />
            <span className="sr-only">{t('edit')}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTarget({ resource: 'groups', id: row.id, name: row.name })}
          >
            <Trash2 />
            <span className="sr-only">{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ];

  if (configuration.isLoading) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6 lg:p-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  if (configuration.isError || !configuration.data) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
        <Card>
          <CardHeader>
            <CardTitle>{t('failedToLoadData')}</CardTitle>
            <CardDescription>{t('retry')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => configuration.refetch()}>{t('retry')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1600px] p-6 lg:p-8">
      <PageHeader
        title={t('academyConfiguration')}
        subtitle={t('academyConfigurationDescription')}
        breadcrumbs={[{ label: t('administration'), href: '/admin' }, { label: t('academyConfiguration') }]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-5 h-auto w-full justify-start overflow-x-auto bg-transparent p-0">
          <TabsTrigger value="schools" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <Building2 />{t('schools')}
          </TabsTrigger>
          <TabsTrigger value="rooms" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <DoorOpen />{t('rooms')}
          </TabsTrigger>
          <TabsTrigger value="courses" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <BookOpen />{t('courses')}
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <UsersRound />{t('navGroups')}
          </TabsTrigger>
          <TabsTrigger value="schedule" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <Building2 />{t('resourceCalendar')}
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-2 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none">
            <GitBranch />{t('pipelineStages')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schools" className="mt-0">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('schools')}</CardTitle>
                <CardDescription>{t('schoolsDescription')}</CardDescription>
              </div>
              <Button onClick={() => openSchool()}>
                <Plus data-icon="inline-start" />{t('addSchool')}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={schoolColumns}
                data={schools}
                keyExtractor={(row) => `school-${row.id}`}
                defaultSortKey="name"
                emptyState={<EmptyTableState title={t('noSchools')} description={t('noSchoolsDescription')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rooms" className="mt-0">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('rooms')}</CardTitle>
                <CardDescription>{t('noRoomsDescription')}</CardDescription>
              </div>
              <Button onClick={() => openRoom()}>
                <Plus data-icon="inline-start" />{t('addRoom')}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={roomColumns}
                data={rooms}
                keyExtractor={(row) => `room-${row.id}`}
                defaultSortKey="name"
                emptyState={<EmptyTableState title={t('noRooms')} description={t('noRoomsDescription')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-0">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('courses')}</CardTitle>
                <CardDescription>{t('coursesManagementDescription')}</CardDescription>
              </div>
              <Button onClick={() => openCourse()}>
                <Plus data-icon="inline-start" />{t('addCourse')}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={courseColumns}
                data={courses}
                keyExtractor={(row) => `course-${row.id}`}
                defaultSortKey="name"
                emptyState={<EmptyTableState title={t('noCourses')} description={t('noCoursesDescription')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups" className="mt-0">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('navGroups')}</CardTitle>
                <CardDescription>{t('groupsDescription')}</CardDescription>
              </div>
              <Button onClick={() => openGroup()}>
                <Plus data-icon="inline-start" />{t('addGroup')}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={groupColumns}
                data={groups}
                keyExtractor={(row) => `group-${row.id}`}
                defaultSortKey="name"
                emptyState={<EmptyTableState title={t('noGroups')} description={t('noGroupsDescription')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="mt-0">
          <AdminScheduleCalendar schools={schools} />
        </TabsContent>

        <TabsContent value="pipeline" className="mt-0">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{t('pipelineStages')}</CardTitle>
                <CardDescription>{t('pipelineStagesDescription')}</CardDescription>
              </div>
              <Button onClick={() => openStatus()}>
                <Plus data-icon="inline-start" />{t('addPipelineStage')}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {statuses.map((status, index) => (
                <div key={status.id} className="flex flex-col gap-3 rounded-xl border border-border p-4 md:flex-row md:items-center">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0 || updateStatusOrder.isPending}
                      onClick={() => updateStatusOrder.mutate({ status, direction: -1 })}
                    >
                      <ArrowUp />
                      <span className="sr-only">{t('moveUp')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === statuses.length - 1 || updateStatusOrder.isPending}
                      onClick={() => updateStatusOrder.mutate({ status, direction: 1 })}
                    >
                      <ArrowDown />
                      <span className="sr-only">{t('moveDown')}</span>
                    </Button>
                  </div>
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{status.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{status.code}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={status.isPipeline ? 'default' : 'secondary'}>
                      {status.isPipeline ? t('shownInPipeline') : t('hiddenFromPipeline')}
                    </Badge>
                    <Badge variant={status.isActive ? 'outline' : 'secondary'}>
                      {status.isActive ? t('active') : t('inactive')}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => openStatus(status)}>
                      <Edit3 />
                      <span className="sr-only">{t('edit')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget({ resource: 'pipeline-statuses', id: status.id, name: status.name })}
                    >
                      <Trash2 />
                      <span className="sr-only">{t('delete')}</span>
                    </Button>
                  </div>
                </div>
              ))}
              {statuses.length === 0 ? (
                <EmptyTableState title={t('noPipelineStages')} description={t('noPipelineStagesDescription')} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      <Dialog open={schoolDialogOpen} onOpenChange={setSchoolDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingSchool ? t('editSchool') : t('addSchool')}</DialogTitle>
            <DialogDescription>{t('schoolFormDescription')}</DialogDescription>
          </DialogHeader>
          <Form {...schoolForm}>
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={schoolForm.handleSubmit((values) => saveSchool.mutate(values))}>
              <FormField control={schoolForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('schoolName')}</FormLabel>
                  <FormControl><Input {...field} onBlur={(event) => {
                    field.onBlur();
                    if (!schoolForm.getValues('code')) schoolForm.setValue('code', slugify(event.target.value));
                  }} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={schoolForm.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('code')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={schoolForm.control} name="address" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>{t('address')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={schoolForm.control} name="timezone" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('timezone')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={schoolForm.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3 md:col-span-2">
                  <FormLabel>{t('activeSchool')}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setSchoolDialogOpen(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={saveSchool.isPending}>{t('save')}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRoom ? t('editRoom') : t('addRoom')}</DialogTitle>
            <DialogDescription>{t('noRoomsDescription')}</DialogDescription>
          </DialogHeader>
          <Form {...roomForm}>
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={roomForm.handleSubmit((values) => saveRoom.mutate(values))}>
              <FormField control={roomForm.control} name="schoolId" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('school')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t('selectSchool')} /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {schools.filter((school) => school.isActive !== false).map((school) => (
                          <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={roomForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('roomName')}</FormLabel>
                  <FormControl><Input {...field} placeholder={t('roomPlaceholder')} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={roomForm.control} name="capacity" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('roomCapacity')}</FormLabel>
                  <FormControl><Input type="number" min="1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={roomForm.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <FormLabel>{t('active')}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setRoomDialogOpen(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={saveRoom.isPending}>{saveRoom.isPending ? t('saving') : t('save')}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCourse ? t('editCourse') : t('addCourse')}</DialogTitle>
            <DialogDescription>{t('courseFormDescription')}</DialogDescription>
          </DialogHeader>
          <Form {...courseForm}>
            <form className="flex flex-col gap-5" onSubmit={courseForm.handleSubmit((values) => saveCourse.mutate(values))}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FormField control={courseForm.control} name="name" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('courseName')}</FormLabel>
                    <FormControl><Input {...field} onBlur={(event) => {
                      field.onBlur();
                      if (!courseForm.getValues('slug')) courseForm.setValue('slug', slugify(event.target.value));
                    }} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="slug" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('code')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="ageCategory" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('ageCategory')}</FormLabel>
                    <FormControl><Input {...field} placeholder="10–15" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="lessonCount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('lessonsCount')}</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="lessonDurationMinutes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('lessonDurationMinutes')}</FormLabel>
                    <FormControl><Input type="number" min="15" step="15" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="durationDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('courseDurationDays')}</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="basePriceUzs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('basePrice')}</FormLabel>
                    <FormControl><Input type="number" min="0" step="1000" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="frequency" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('frequency')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('frequencyPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={courseForm.control} name="description" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('description')}</FormLabel>
                    <FormControl><Textarea {...field} rows={3} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('eligibleTeachers')}</p>
                  <p className="text-xs text-muted-foreground">{t('eligibleTeachersDescription')}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {teachers.map((teacher) => (
                    <label key={teacher.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
                      <Checkbox
                        checked={courseTeacherIds.includes(teacher.id)}
                        onCheckedChange={(checked) => setCourseTeacherIds((current) => (
                          checked === true
                            ? [...new Set([...current, teacher.id])]
                            : current.filter((id) => id !== teacher.id)
                        ))}
                      />
                      <span className="text-sm font-medium text-foreground">{teacher.fullName}</span>
                    </label>
                  ))}
                  {teachers.length === 0 ? <p className="text-sm text-muted-foreground">{t('noTeachers')}</p> : null}
                </div>
              </div>

              <FormField control={courseForm.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <FormLabel>{t('activeCourse')}</FormLabel>
                    <p className="text-xs text-muted-foreground">{t('activeCourseDescription')}</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCourseDialogOpen(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={saveCourse.isPending}>{saveCourse.isPending ? t('saving') : t('save')}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGroup ? t('editGroup') : t('createGroup')}</DialogTitle>
            <DialogDescription>{t('groupFormDescription')}</DialogDescription>
          </DialogHeader>
          <Form {...groupForm}>
            <form
              className="flex flex-col gap-5"
              onSubmit={groupForm.handleSubmit((values) => {
                const scheduleError = getGroupScheduleValidationError(groupSchedule);
                if (scheduleError) {
                  const title = scheduleError === 'groupScheduleRequired'
                    ? t('groupScheduleRequired')
                    : scheduleError === 'groupScheduleInvalid'
                      ? t('groupScheduleInvalid')
                      : t('groupScheduleOverlap');
                  toast({ title, variant: 'destructive' });
                  return;
                }
                saveGroup.mutate(values);
              })}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FormField control={groupForm.control} name="name" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('groupName')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('groupNamePlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('status')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="open">{t('groupStatusOpen')}</SelectItem>
                          <SelectItem value="in_progress">{t('groupStatusInProgress')}</SelectItem>
                          <SelectItem value="completed">{t('groupStatusCompleted')}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex flex-col justify-center gap-1 rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t('groupCapacity')}</p>
                  <p className="text-sm font-semibold text-foreground">12 {t('students')}</p>
                  <p className="text-[11px] text-muted-foreground">{t('groupCapacityDescription')}</p>
                </div>
                <FormField control={groupForm.control} name="courseId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('course')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder={t('selectCourse')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {courses.filter((course) => course.isActive !== false).map((course) => (
                            <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="schoolId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('school')}</FormLabel>
                    <Select value={field.value} onValueChange={(value) => {
                      field.onChange(value);
                      if (value !== selectedGroupSchoolId) groupForm.setValue('roomId', '');
                    }}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t('selectSchool')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {schools.filter((school) => school.isActive !== false).map((school) => (
                            <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="roomId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('room')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!selectedGroupSchoolId}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t('roomRequired')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {groupRooms.map((room) => (
                            <SelectItem key={room.id} value={String(room.id)}>
                              {room.name} · {room.capacity} {t('students')}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('startDate')}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('endDate')}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('schedule')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('roomScheduleRule')} · {t('teacherWillBeAssigned')}
                  </p>
                </div>
                <WeekScheduleEditor
                  value={groupSchedule}
                  onChange={setGroupSchedule}
                  dayNames={dayNames}
                  startLabel={t('start')}
                  endLabel={t('end')}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setGroupDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saveGroup.isPending}>
                  {saveGroup.isPending ? t('saving') : t('save')}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingStatus ? t('editPipelineStage') : t('addPipelineStage')}</DialogTitle>
            <DialogDescription>{t('pipelineStageFormDescription')}</DialogDescription>
          </DialogHeader>
          <Form {...statusForm}>
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={statusForm.handleSubmit((values) => saveStatus.mutate(values))}>
              <FormField control={statusForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={statusForm.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('code')}</FormLabel>
                  <FormControl><Input {...field} disabled={editingStatus?.isSystem} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={statusForm.control} name="color" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('color')}</FormLabel>
                  <div className="flex gap-2">
                    <FormControl><Input type="color" className="w-16 p-1" {...field} /></FormControl>
                    <Input value={field.value} onChange={field.onChange} />
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={statusForm.control} name="sortOrder" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('sortOrder')}</FormLabel>
                  <FormControl><Input type="number" min="0" step="10" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={statusForm.control} name="isPipeline" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <FormLabel>{t('shownInPipeline')}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={statusForm.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <FormLabel>{t('active')}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setStatusDialogOpen(false)}>{t('cancel')}</Button>
                <Button
                  type="button"
                  disabled={saveStatus.isPending}
                  onClick={statusForm.handleSubmit((values) => saveStatus.mutate(values))}
                >
                  {t('save')}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('confirmDeleteResource')}
        description={deleteTarget ? `${t('deleteResourceDescription')} “${deleteTarget.name}”?` : ''}
        confirmLabel={t('delete')}
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteResource.mutate(deleteTarget);
        }}
      />
    </div>
  );
}
