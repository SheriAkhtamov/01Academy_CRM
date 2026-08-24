import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { canManageUsers, formatUserModule } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import {
  WeekScheduleEditor,
  type WeekScheduleItem,
} from '@/components/ux/WeekScheduleEditor';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
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
import { Switch } from '@/components/ui/switch';
import {
  Plus,
  Users,
  Shield,
  UserCheck,
  Key,
  ArrowRight,
  Plug,
  SlidersHorizontal,
  KanbanSquare,
  PhoneCall,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { devLog } from '@/lib/debug';
import { MODULE_NAVIGATION } from '@/lib/moduleNavigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { EmployeeArchiveDialogs } from '@/features/employees/EmployeeArchiveDialogs';
import { EmployeeRosterControls, EmployeeRowActions } from '@/features/employees/EmployeeRosterControls';
import {
  archiveEmployee,
  createEmployee,
  deleteEmployee,
  getEmployeeCredentials,
  getEmployeeResponsibilityImpact,
  resetEmployeePassword,
  restoreEmployee,
  updateEmployee,
  updateEmployeeCredentials,
} from '@/features/employees/employees-api';
import {
  ACADEMY_ACCESS_MODULES,
  ACADEMY_MODULES,
  getAssignedModules,
  type AcademyAccessModule,
  type AcademyModule,
} from '@shared/academy';

// Schema functions that use runtime translation
const createUserSchema = (t: any) => z.object({
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().email(t('invalidEmailAddress')).optional()
  ),
  fullName: z.string().min(1, t('fullNameRequired')),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  position: z.string().optional(),
  module: z.enum(ACADEMY_MODULES),
  modules: z.array(z.enum(ACADEMY_ACCESS_MODULES)).min(1, t('selectAtLeastOneModule')),
  teacherSchoolIds: z.array(z.number().int().positive()).default([]),
  teacherAvailability: z.array(z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
    schoolId: z.number().int().positive().nullable().optional(),
  })).default([]),
  isActive: z.boolean().default(true),
});

const createCredentialsSchema = (t: any) => z.object({
  email: z.string().email(t('invalidEmailAddress')),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}).superRefine((values, ctx) => {
  const wantsPasswordChange = Boolean(values.password || values.confirmPassword);

  if (!wantsPasswordChange) return;

  if (!values.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('newPasswordRequired'),
    });
  } else if (values.password.length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('passwordTooShort'),
    });
  } else if (new TextEncoder().encode(values.password).length > 72) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('passwordTooLong'),
    });
  }

  if (values.password !== values.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmPassword'],
      message: t('passwordsDoNotMatch'),
    });
  }
});

type UserFormValues = z.infer<ReturnType<typeof createUserSchema>>;
type UserUpdatePayload = Partial<UserFormValues> & { leadTransferManagerId?: number };

const defaultUserFormValues: UserFormValues = {
  email: '',
  fullName: '',
  phone: '',
  dateOfBirth: '',
  position: '',
  module: 'sales',
  modules: ['sales'],
  teacherSchoolIds: [],
  teacherAvailability: [],
  isActive: true,
};

const formatDateInputValue = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return '';
};

interface AdminProps {
  mode?: 'admin' | 'employees';
}

export default function Admin({ mode = 'admin' }: AdminProps) {
  const isEmployeesPage = mode === 'employees';
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any>(null);
  const [userToArchive, setUserToArchive] = useState<any>(null);
  const [userToRestore, setUserToRestore] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userCredentials, setUserCredentials] = useState<any>(null);
  const [pendingCredentialUpdate, setPendingCredentialUpdate] = useState<z.infer<ReturnType<typeof createCredentialsSchema>> | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<any>(null);
  const [salesModuleTransfer, setSalesModuleTransfer] = useState<{
    user: any;
    action: 'update' | 'delete' | 'archive';
    data?: UserFormValues;
    leadCount: number;
  } | null>(null);
  const [salesLeadTransferManagerId, setSalesLeadTransferManagerId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [employeeListView, setEmployeeListView] = useState<'current' | 'archive'>('current');
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Create schemas with translations
  const userSchema = createUserSchema(t);
  const credentialsSchema = useMemo(() => createCredentialsSchema(t), [t]);
  const userForm = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: defaultUserFormValues,
  });
  const credentialsForm = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    if (!userCredentials) return;
    credentialsForm.reset({
      email: userCredentials.email || '',
      password: '',
      confirmPassword: '',
    });
  }, [credentialsForm, userCredentials]);

  const handleUserModalState = (open: boolean) => {
    setShowCreateUserModal(open);
    if (!open) {
      setSelectedUser(null);
      setSalesModuleTransfer(null);
      setSalesLeadTransferManagerId('');
      userForm.reset(defaultUserFormValues);
    }
  };
  // Every open starts from a known-clean form: otherwise the previous employee's
  // values survive here and an untouched form is reported as having unsaved changes.
  const openCreateUserModal = () => {
    setSelectedUser(null);
    userForm.reset(defaultUserFormValues);
    setShowCreateUserModal(true);
  };
  const userDialogGuard = useUnsavedChangesGuard({
    open: showCreateUserModal,
    isDirty: userForm.formState.isDirty,
    onOpenChange: handleUserModalState,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });
  const { data: schools = [] } = useQuery<Array<{
    id: number;
    name: string;
    isActive?: boolean;
  }>>({
    queryKey: ['/api/academy/schools'],
    enabled: isEmployeesPage,
  });

  const activeUserCount = users.filter((candidate: any) => !candidate.isArchived && candidate.isActive).length;
  const inactiveUserCount = users.filter((candidate: any) => !candidate.isArchived && !candidate.isActive).length;
  const archivedUserCount = users.filter((candidate: any) => candidate.isArchived).length;
  const settingsSnapshotTime = new Date().toLocaleTimeString();

  const createUserMutation = useMutation({
    mutationFn: async (data: z.infer<ReturnType<typeof createUserSchema>>) => {
      return await createEmployee(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setUserCredentials(data);
      setShowCredentialsModal(true);
      toast({
        title: t('userCreatedSuccessfullyTitle'),
        description: t('newUserAddedDescription'),
      });
      handleUserModalState(false);
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedCreateUserDescription'),
        variant: 'destructive',
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UserUpdatePayload }) => {
      return await updateEmployee(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('userUpdatedSuccessfullyTitle'),
        description: t('userInformationUpdatedDescription'),
      });
      handleUserModalState(false);
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedUpdateUserDescription'),
        variant: 'destructive',
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async ({ id, leadTransferManagerId }: { id: number; leadTransferManagerId?: number }) => {
      return await deleteEmployee(id, leadTransferManagerId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('userDeletedSuccessfullyTitle'),
        description: t('userRemovedFromSystemDescription'),
      });
      setUserToDelete(null);
      setSalesModuleTransfer(null);
      setSalesLeadTransferManagerId('');
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedDeleteUserDescription'),
        variant: 'destructive',
      });
    },
  });

  const archiveUserMutation = useMutation({
    mutationFn: async ({ id, leadTransferManagerId }: { id: number; leadTransferManagerId?: number }) => (
      archiveEmployee(id, leadTransferManagerId)
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('employeeArchivedTitle'),
        description: t('employeeArchivedDescription'),
      });
      setUserToArchive(null);
      setSalesModuleTransfer(null);
      setSalesLeadTransferManagerId('');
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedArchiveEmployee'),
        variant: 'destructive',
      });
    },
  });

  const restoreUserMutation = useMutation({
    mutationFn: async (id: number) => restoreEmployee(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('employeeRestoredTitle'),
        description: t('employeeRestoredDescription'),
      });
      setUserToRestore(null);
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedRestoreEmployee'),
        variant: 'destructive',
      });
    },
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await resetEmployeePassword(userId);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setUserCredentials(data);
      toast({
        title: t('passwordResetSuccessfullyTitle'),
        description: t('passwordResetDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedResetPasswordDescription'),
        variant: 'destructive',
      });
    },
  });

  const updateUserCredentialsMutation = useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: number;
      data: z.infer<ReturnType<typeof createCredentialsSchema>>;
    }) => {
      return await updateEmployeeCredentials(userId, data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setUserCredentials(data);
      credentialsForm.reset({
        email: data.email || '',
        password: '',
        confirmPassword: '',
      });
      toast({
        title: t('credentialsUpdatedTitle'),
        description: t('credentialsUpdatedDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedToUpdateCredentials'),
        variant: 'destructive',
      });
    },
  });

  const fetchUserCredentials = async (userId: number) => {
    try {
      devLog('Fetching credentials for user ID:', userId);

      const credentials = await getEmployeeCredentials(userId);
      devLog('Credentials received for user ID:', userId);
      setUserCredentials(credentials);
      setShowCredentialsModal(true);
    } catch (error) {
      devLog('Error fetching user credentials:', error);
      toast({
        title: t('error'),
        description: t('failedToFetchCredentials'),
        variant: 'destructive',
      });
    }
  };

  const salesTransferManagers = useMemo(
    () => users.filter((candidate: any) => (
      candidate.isActive !== false
      && !candidate.isArchived
      && Number(candidate.id) !== Number(salesModuleTransfer?.user.id ?? selectedUser?.id)
      && getAssignedModules(candidate).includes('sales')
    )),
    [salesModuleTransfer?.user.id, selectedUser?.id, users],
  );

  const openLeadTransferDialog = (pending: typeof salesModuleTransfer) => {
    setSalesModuleTransfer(pending);
    const firstEligibleManager = users.find((candidate: any) => (
      candidate.isActive !== false
      && !candidate.isArchived
      && Number(candidate.id) !== Number(pending?.user.id)
      && getAssignedModules(candidate).includes('sales')
    ));
    setSalesLeadTransferManagerId(firstEligibleManager ? String(firstEligibleManager.id) : '');
  };

  const getAssignedResponsibilityCount = async (employee: any, includeAllOpenTasks = false) => {
    const impact = await getEmployeeResponsibilityImpact(employee.id);
    const fallback = Number(impact?.leadCount ?? 0);
    return Number(includeAllOpenTasks
      ? impact?.offboardingResponsibilityCount ?? fallback
      : impact?.salesResponsibilityCount ?? fallback);
  };

  const archiveEmployeeAfterImpactCheck = (employee: any) => {
    void getAssignedResponsibilityCount(employee, true)
      .then((leadCount) => {
        if (leadCount > 0) {
          openLeadTransferDialog({ user: employee, action: 'archive', leadCount });
          return;
        }
        archiveUserMutation.mutate({ id: employee.id });
      })
      .catch((error: Error) => {
        toast({
          title: t('error'),
          description: error.message || t('failedArchiveEmployee'),
          variant: 'destructive',
        });
      });
  };

  const onSubmitUser = async (data: z.infer<ReturnType<typeof createUserSchema>>) => {
    const modules = Array.from(new Set([data.module, ...data.modules]));
    const payload = {
      ...data,
      modules,
    };

    if (selectedUser) {
      const losesSalesEligibility = !data.isActive || !modules.includes('sales');
      if (losesSalesEligibility) {
        try {
          const leadCount = await getAssignedResponsibilityCount(selectedUser, !data.isActive);
          if (leadCount > 0) {
            openLeadTransferDialog({ user: selectedUser, action: 'update', data: payload, leadCount });
            return;
          }
        } catch (error: any) {
          toast({
            title: t('error'),
            description: error.message || t('failedUpdateUserDescription'),
            variant: 'destructive',
          });
          return;
        }
      }
      const { email: _email, ...profileData } = payload;
      updateUserMutation.mutate({ id: selectedUser.id, data: profileData });
    } else {
      createUserMutation.mutate(payload);
    }
  };

  const onSubmitCredentials = (data: z.infer<typeof credentialsSchema>) => {
    if (!userCredentials?.id) return;

    const normalizedEmail = data.email.trim().toLowerCase();
    const loginChanged = normalizedEmail !== String(userCredentials.email || '').toLowerCase();
    const passwordChanged = Boolean(data.password);

    if (!loginChanged && !passwordChanged) {
      toast({
        title: t('noChangesTitle'),
        description: t('credentialsNoChanges'),
      });
      return;
    }

    setPendingCredentialUpdate({
      email: normalizedEmail,
      password: data.password || '',
      confirmPassword: data.confirmPassword || '',
    });
  };

  const openEditUserModal = (user: any) => {
    setSelectedUser(user);
    userForm.reset({
      email: user.email,
      fullName: user.fullName,
      phone: user.phone || '',
      dateOfBirth: formatDateInputValue(user.dateOfBirth),
      position: user.position || '',
      module: user.module,
      modules: getAssignedModules(user),
      teacherSchoolIds: Array.isArray(user.teacherSchoolIds)
        ? user.teacherSchoolIds.map(Number).filter(Number.isSafeInteger)
        : [],
      teacherAvailability: Array.isArray(user.teacherAvailability)
        ? user.teacherAvailability
        : [],
      isActive: user.isActive,
    });
    setShowCreateUserModal(true);
  };

  const filteredUsers = users.filter((user: any) => {
    const matchesArchiveView = employeeListView === 'archive'
      ? user.isArchived === true
      : user.isArchived !== true;
    const matchesSearch = user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = moduleFilter === 'all' ||
      getAssignedModules(user).includes(moduleFilter as AcademyAccessModule);
    return matchesArchiveView && matchesSearch && matchesModule;
  });

  const getModuleColor = (module: string) => {
    switch (module) {
      case 'administration':
        return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300';
      case 'sales':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
      case 'teacher':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
      case 'marketing':
        return 'bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300';
      case 'finance':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
      default:
        return 'bg-muted text-foreground';
    }
  };

  const getModuleLabel = (module: string) => formatUserModule(module, t);
  const getModuleLabels = (user: any) => getAssignedModules(user).map(getModuleLabel);

  const getStatusColor = (isActive: boolean) => {
    return isActive
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
      : 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300';
  };

  const primaryModuleOptions = [
    { value: 'administration', label: t(MODULE_NAVIGATION.administration.nameKey) },
    { value: 'sales', label: t(MODULE_NAVIGATION.sales.nameKey) },
    { value: 'teacher', label: t(MODULE_NAVIGATION.teacher.nameKey) },
    { value: 'marketing', label: t(MODULE_NAVIGATION.marketing.nameKey) },
  ] as const;
  const accessModuleOptions = [
    ...primaryModuleOptions,
    { value: 'finance', label: t(MODULE_NAVIGATION.finance.nameKey) },
  ] as const;
  const primaryModuleValue = userForm.watch('module');
  const assignedModuleValues = userForm.watch('modules');
  const teacherModuleEnabled = assignedModuleValues.includes('teacher');
  const selectedTeacherSchoolIds = userForm.watch('teacherSchoolIds');
  const teacherScheduleSchools = schools.filter((school) => (
    school.isActive !== false || selectedTeacherSchoolIds.includes(school.id)
  ));
  const teacherScheduleDayNames = [
    t('monday'),
    t('tuesday'),
    t('wednesday'),
    t('thursday'),
    t('friday'),
    t('saturday'),
    t('sunday'),
  ];

  const administrationSections = [
    {
      href: '/employees',
      icon: Users,
      title: t('employees'),
      description: t('adminEmployeesDescription'),
    },
    {
      href: '/admin/tasks',
      icon: KanbanSquare,
      title: t('taskBoard'),
      description: t('taskBoardSubtitle'),
    },
    {
      href: '/admin/academy-settings',
      icon: SlidersHorizontal,
      title: t('academyConfiguration'),
      description: t('academyConfigurationDescription'),
    },
    {
      href: '/admin/sales-settings',
      icon: UserCheck,
      title: t('salesSettings'),
      description: t('salesSettingsDescription'),
    },
    {
      href: '/integrations',
      icon: Plug,
      title: t('navIntegrations'),
      description: t('adminIntegrationsDescription'),
    },
  ];

  const userColumns: DataTableColumn<any>[] = [
    {
      key: 'user',
      header: t('user'),
      sortable: true,
      accessor: (row) => `${row.fullName} ${row.email}`,
      render: (row) => (
        <div className="flex items-center space-x-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))', boxShadow: 'var(--shadow-primary)' }}
          >
            <span>
              {row.fullName.split(' ').map((name: string) => name[0]).join('').slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{row.fullName}</p>
            <p className="text-sm text-muted-foreground truncate">{row.email}</p>
            {row.position && <p className="text-xs text-muted-foreground truncate">{row.position}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'module',
      header: t('accessModules'),
      sortable: true,
      accessor: (row) => getModuleLabels(row).join(' '),
      render: (row) => (
        <div className="flex max-w-sm flex-wrap gap-1.5">
          <Badge className={getModuleColor(row.module)}>
            {getModuleLabel(row.module)}
          </Badge>
          {getAssignedModules(row)
            .filter((module) => module !== row.module)
            .map((module) => (
              <Badge key={module} variant="outline" className={getModuleColor(module)}>
                {getModuleLabel(module)}
              </Badge>
            ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (row) => row.isArchived ? t('employeeArchived') : row.isActive ? t('active') : t('inactive'),
      render: (row) => (
        <Badge
          variant={row.isArchived ? 'outline' : 'default'}
          className={row.isArchived ? 'border-slate-300 text-slate-700 dark:text-slate-300' : getStatusColor(row.isActive)}
        >
          {row.isArchived ? t('employeeArchived') : row.isActive ? t('active') : t('inactive')}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: t('created'),
      sortable: true,
      accessor: (row) => row.createdAt ? new Date(row.createdAt).getTime() : 0,
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : t('notAvailable')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      cellClassName: 'text-right',
      render: (row) => (
        <EmployeeRowActions
          employee={row}
          currentUserId={user?.id}
          onCredentials={(employee) => fetchUserCredentials(employee.id)}
          onEdit={openEditUserModal}
          onArchive={setUserToArchive}
          onRestore={setUserToRestore}
          onDelete={setUserToDelete}
        />
      ),
    },
  ];

  if (!user || !canManageUsers(user)) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">{t('accessDenied')}</h3>
            <p className="text-muted-foreground">{t('noAdminPermission')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ModulePage contained={isEmployeesPage}>
      <PageHeader
        title={isEmployeesPage ? t('employees') : t('administration')}
        subtitle={isEmployeesPage ? t('employeesPageSubtitle') : t('adminControlCenterSubtitle')}
        breadcrumbs={isEmployeesPage
          ? [{ label: t(MODULE_NAVIGATION.administration.nameKey), href: '/admin' }, { label: t('employees') }]
          : [{ label: t('administration') }]}
        actions={isEmployeesPage ? (
          <Button onClick={openCreateUserModal}>
            <Plus className="h-4 w-4 mr-2" />
            {t('createEmployee')}
          </Button>
        ) : undefined}
      />

      <ModulePageBody contained={isEmployeesPage} ariaLabel={isEmployeesPage ? t('employees') : t('administration')}>
      <Tabs value={isEmployeesPage ? 'users' : 'reports'} className="space-y-6">
        {/* Users Tab */}
        {isEmployeesPage && (
        <TabsContent value="users" className="space-y-6">
          {/* User Management Header */}
          <div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t('userManagement')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('createManageUserAccounts')}
              </p>
            </div>
            <Dialog open={showCreateUserModal} onOpenChange={userDialogGuard.handleOpenChange}>
                <DialogContent className="grid max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[90dvh]">
                  <DialogHeader className="shrink-0 border-b border-border px-4 py-5 pr-12 text-left sm:px-6">
                    <DialogTitle>
                      {selectedUser ? t('editUser') : t('addNewUser')}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      {t('createManageUserAccounts')}
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...userForm}>
                    <form
                      onSubmit={userForm.handleSubmit(onSubmitUser)}
                      className="flex min-h-0 flex-col"
                    >
                      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                        <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={userForm.control}
                            name="fullName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('fullName')}</FormLabel>
                                <FormControl>
                                  <Input placeholder={t('fullNamePlaceholder')} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={userForm.control}
                            name="email"
                            render={({ field }) => selectedUser ? (
                                <FormItem>
                                  <FormLabel>{t('loginLabel')}</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="email"
                                      placeholder={t('emailPlaceholder')}
                                      disabled
                                      {...field}
                                    />
                                  </FormControl>
                                  <p className="text-xs text-muted-foreground">{t('loginManagedInCredentials')}</p>
                                  <FormMessage />
                                </FormItem>
                              ) : (
                                <FormItem>
                                  <FormLabel>{t('loginLabel')}</FormLabel>
                                  <div className="rounded-lg border border-dashed border-border bg-muted/70 p-3">
                                    <p className="text-sm font-medium text-foreground">{t('employeeLoginGenerated')}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{t('employeeLoginHint')}</p>
                                  </div>
                                  <input type="hidden" {...field} value="" />
                                  <FormMessage />
                                </FormItem>
                              )}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={userForm.control}
                            name="phone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('phone')}</FormLabel>
                                <FormControl>
                                  <PhoneInput
                                    ref={field.ref}
                                    name={field.name}
                                    value={field.value ?? ''}
                                    onBlur={field.onBlur}
                                    onValueChange={field.onChange}
                                    placeholder={t('phonePlaceholder')}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={userForm.control}
                            name="position"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('position')}</FormLabel>
                                <FormControl>
                                  <Input placeholder={t('positionPlaceholder')} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {assignedModuleValues.includes('sales') ? (
                          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-primary/5 p-4 dark:bg-primary/10">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
                              <PhoneCall className="size-4" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-foreground">
                                  {t('personalTelephonyExtension')}
                                </p>
                                <Badge variant="secondary" className="font-mono">
                                  {selectedUser?.onlinePbxExtension || t('notAssigned')}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                {t('personalTelephonyExtensionHint')}
                              </p>
                            </div>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={userForm.control}
                            name="module"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('primaryModule')}</FormLabel>
                                <Select
                                  onValueChange={(value) => {
                                    const nextModule = value as AcademyModule;
                                    field.onChange(nextModule);
                                    const currentModules = userForm.getValues('modules') ?? [];
                                    if (!currentModules.includes(nextModule)) {
                                      userForm.setValue('modules', [...currentModules, nextModule], {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      });
                                    }
                                  }}
                                  value={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {primaryModuleOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                  {t('moduleAssignmentHint')}
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={userForm.control}
                            name="dateOfBirth"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('dateOfBirth')}</FormLabel>
                                <FormControl>
                                  <Input type="date" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={userForm.control}
                          name="modules"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('accessModules')}</FormLabel>
                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                                {accessModuleOptions.map((option) => {
                                  const value = option.value;
                                  const checked = (field.value ?? []).includes(value);
                                  const isPrimary = primaryModuleValue === value;

                                  return (
                                    <label
                                      key={value}
                                      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                                    >
                                      <Checkbox
                                        checked={checked || isPrimary}
                                        disabled={isPrimary}
                                        onCheckedChange={(nextChecked) => {
                                          const currentModules = field.value ?? [];
                                          if (nextChecked) {
                                            field.onChange([...new Set([...currentModules, value])]);
                                            return;
                                          }

                                          field.onChange(currentModules.filter((module) => module !== value));
                                        }}
                                      />
                                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                      {isPrimary && (
                                        <span className="shrink-0 text-xs text-muted-foreground">{t('primaryModuleShort')}</span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                              <p className="text-xs text-muted-foreground">{t('accessModulesHint')}</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {teacherModuleEnabled ? (
                          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">{t('teacherAvailability')}</h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('teacherAvailabilityAdminDescription')}
                              </p>
                            </div>

                            <FormField
                              control={userForm.control}
                              name="teacherSchoolIds"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('availableSchools')}</FormLabel>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {teacherScheduleSchools.map((school) => {
                                      const checked = field.value.includes(school.id);
                                      return (
                                        <label
                                          key={school.id}
                                          className="flex items-center gap-3 rounded-lg border border-border/70 bg-background p-3 text-sm"
                                        >
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={(nextChecked) => {
                                              if (nextChecked === true) {
                                                field.onChange([...new Set([...field.value, school.id])]);
                                                return;
                                              }
                                              field.onChange(field.value.filter((id) => id !== school.id));
                                              const availability = userForm.getValues('teacherAvailability');
                                              userForm.setValue(
                                                'teacherAvailability',
                                                availability.map((item) => (
                                                  item.schoolId === school.id ? { ...item, schoolId: null } : item
                                                )),
                                                { shouldDirty: true, shouldValidate: true },
                                              );
                                            }}
                                          />
                                          <span className="font-medium text-foreground">{school.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {teacherScheduleSchools.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t('noSchools')}</p>
                                  ) : null}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={userForm.control}
                              name="teacherAvailability"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('workSchedule')}</FormLabel>
                                  <FormControl>
                                    <WeekScheduleEditor
                                      value={field.value as WeekScheduleItem[]}
                                      onChange={field.onChange}
                                      dayNames={teacherScheduleDayNames}
                                      schools={teacherScheduleSchools.filter((school) => (
                                        selectedTeacherSchoolIds.includes(school.id)
                                      ))}
                                      showSchool
                                      allSchoolsLabel={t('allSchools')}
                                      startLabel={t('start')}
                                      endLabel={t('end')}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        ) : null}

                        <FormField
                          control={userForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
                              <div className="min-w-0 space-y-0.5">
                                <FormLabel className="text-base">{t('activeAccount')}</FormLabel>
                                <div className="text-sm text-muted-foreground">
                                  {t('canLoginAccess')}
                                </div>
                              </div>
                              <FormControl>
                                <Switch
                                  className="shrink-0"
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        </div>
                      </div>

                        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-background px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => userDialogGuard.handleOpenChange(false)}
                          >
                            {t('cancel')}
                          </Button>
                          <Button
                            type="submit"
                            disabled={createUserMutation.isPending || updateUserMutation.isPending}
                            className="w-full sm:w-auto"
                          >
                            {createUserMutation.isPending || updateUserMutation.isPending
                              ? t('saving')
                              : selectedUser
                                ? t('updateUser')
                                : t('createUser')}
                          </Button>
                        </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
              <UnsavedChangesDialog
                open={userDialogGuard.confirmationOpen}
                onOpenChange={userDialogGuard.setConfirmationOpen}
                onDiscard={userDialogGuard.discardChanges}
              />
          </div>

          <EmployeeRosterControls
            activeCount={activeUserCount}
            inactiveCount={inactiveUserCount}
            archivedCount={archivedUserCount}
            snapshotTime={settingsSnapshotTime}
            view={employeeListView}
            onViewChange={setEmployeeListView}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            moduleFilter={moduleFilter}
            onModuleFilterChange={setModuleFilter}
            moduleOptions={accessModuleOptions}
          />

          {/* Users List */}
          <Card>
            <CardContent className="p-0">
              {usersLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="flex items-center gap-4 rounded-lg border border-slate-100 p-3">
                      <Skeleton className="w-10 h-10 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-64" />
                      </div>
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-8 w-24" />
                    </div>
                  ))}
                </div>
              ) : (
                <DataTable
                  columns={userColumns}
                  data={filteredUsers}
                  keyExtractor={(row) => `user-${row.id}`}
                  defaultSortKey="user"
                  emptyState={
                    <div className="px-6 py-12 text-center">
                      <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-foreground mb-2">
                        {employeeListView === 'archive' ? t('noArchivedEmployees') : t('noUsersFound')}
                      </h3>
                      <p className="text-muted-foreground mb-4">
                        {searchTerm || moduleFilter !== 'all'
                          ? t('adjustSearchCriteria')
                          : employeeListView === 'archive'
                            ? t('noArchivedEmployeesDescription')
                          : t('createFirstUser')}
                      </p>
                    </div>
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* Administration control center */}
        <TabsContent value="reports" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {administrationSections.map((section) => {
              const Icon = section.icon;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="h-full cursor-pointer hover:shadow-md">
                    <CardContent className="flex h-full items-start gap-4 p-5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="font-semibold text-foreground">{section.title}</h2>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{section.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('systemStatistics')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">{t('totalUsers')}</span>
                  <span className="text-sm font-medium">{users.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">{t('activeUsers')}</span>
                  <span className="text-sm font-medium">
                    {users.filter((u: any) => u.isActive).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">{t(MODULE_NAVIGATION.administration.nameKey)}</span>
                  <span className="text-sm font-medium">
                    {users.filter((u: any) => getAssignedModules(u).includes('administration')).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">{t(MODULE_NAVIGATION.sales.nameKey)}</span>
                  <span className="text-sm font-medium">
                    {users.filter((u: any) => getAssignedModules(u).includes('sales')).length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </ModulePageBody>

      <Dialog
        open={Boolean(salesModuleTransfer)}
        onOpenChange={(open) => {
          if (!open && !updateUserMutation.isPending && !deleteUserMutation.isPending && !archiveUserMutation.isPending) {
            setSalesModuleTransfer(null);
            setSalesLeadTransferManagerId('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('salesModuleLeadsTransferTitle')}</DialogTitle>
            <DialogDescription>
              {salesModuleTransfer
                ? t('salesModuleLeadsTransferDescription')
                  .replace('{count}', String(salesModuleTransfer.leadCount))
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="sales-lead-transfer-manager">
              {t('responsibleManager')}
            </label>
            <Select
              value={salesLeadTransferManagerId}
              onValueChange={setSalesLeadTransferManagerId}
              disabled={updateUserMutation.isPending || deleteUserMutation.isPending || archiveUserMutation.isPending || salesTransferManagers.length === 0}
            >
              <SelectTrigger id="sales-lead-transfer-manager">
                <SelectValue placeholder={t('selectResponsibleManager')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {salesTransferManagers.map((manager) => (
                    <SelectItem key={manager.id} value={String(manager.id)}>{manager.fullName}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {salesTransferManagers.length === 0 ? (
              <p className="text-sm text-destructive">{t('salesModuleLeadsTransferRequired')}</p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSalesModuleTransfer(null);
                setSalesLeadTransferManagerId('');
              }}
              disabled={updateUserMutation.isPending || deleteUserMutation.isPending || archiveUserMutation.isPending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={!salesLeadTransferManagerId || updateUserMutation.isPending || deleteUserMutation.isPending || archiveUserMutation.isPending}
              onClick={() => {
                if (!salesModuleTransfer) return;
                const leadTransferManagerId = Number(salesLeadTransferManagerId);
                if (salesModuleTransfer.action === 'delete') {
                  deleteUserMutation.mutate({ id: salesModuleTransfer.user.id, leadTransferManagerId });
                  return;
                }
                if (salesModuleTransfer.action === 'archive') {
                  archiveUserMutation.mutate({ id: salesModuleTransfer.user.id, leadTransferManagerId });
                  return;
                }
                if (salesModuleTransfer.data) {
                  const { email: _email, ...profileData } = salesModuleTransfer.data;
                  updateUserMutation.mutate({
                    id: salesModuleTransfer.user.id,
                    data: { ...profileData, leadTransferManagerId },
                  });
                }
              }}
            >
              {updateUserMutation.isPending || deleteUserMutation.isPending || archiveUserMutation.isPending
                ? t('saving')
                : t('disableSalesAndTransfer')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* User Credentials Modal */}
      <Dialog open={showCredentialsModal} onOpenChange={setShowCredentialsModal}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Key className="h-5 w-5" />
              <span>{t('userCredentials')}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('employeeLoginHint')}
            </DialogDescription>
          </DialogHeader>
          {userCredentials && (
            <Form {...credentialsForm}>
              <form onSubmit={credentialsForm.handleSubmit(onSubmitCredentials)} className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-sm font-medium text-foreground">{userCredentials.fullName}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className={getModuleColor(userCredentials.module)}>
                      {getModuleLabel(userCredentials.module)}
                    </Badge>
                    {getAssignedModules(userCredentials)
                      .filter((module) => module !== userCredentials.module)
                      .map((module) => (
                        <Badge key={module} variant="outline" className={getModuleColor(module)}>
                          {getModuleLabel(module)}
                        </Badge>
                      ))}
                    {userCredentials.position && (
                      <span className="text-xs text-muted-foreground">{userCredentials.position}</span>
                    )}
                  </div>
                </div>

                <FormField
                  control={credentialsForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('loginLabel')}</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-foreground">{t('password')}</label>
                  <div className={`min-w-0 break-all rounded-md p-3 font-mono text-sm ${userCredentials.temporaryPassword ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-900' : 'bg-slate-50 text-muted-foreground italic'}`}>
                    {userCredentials.temporaryPassword || t('passwordNotAvailable')}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {userCredentials.temporaryPassword
                      ? t('storedCredentialPasswordHint')
                      : userCredentials.passwordVisibleToAdministration
                        ? t('passwordUnavailableAdminHint')
                        : t('passwordHiddenForNonAdministration')}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={credentialsForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('newPassword')}</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder={t('newPassword')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={credentialsForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('confirmNewPassword')}</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder={t('confirmNewPassword')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  {userCredentials.id && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPasswordResetUser(userCredentials)}
                      disabled={resetUserPasswordMutation.isPending}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      {resetUserPasswordMutation.isPending ? t('resettingPassword') : t('resetPassword')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const credentialLines = [`${t('email')}: ${userCredentials.email}`];
                      if (userCredentials.temporaryPassword) {
                        credentialLines.push(`${t('password')}: ${userCredentials.temporaryPassword}`);
                      }
                      credentialLines.push(`${t('primaryModule')}: ${getModuleLabel(userCredentials.module)}`);
                      credentialLines.push(`${t('accessModules')}: ${getModuleLabels(userCredentials).join(', ')}`);
                      navigator.clipboard.writeText(credentialLines.join('\n'));
                      toast({
                        title: t('copiedToClipboard'),
                        description: t('credentialsCopied'),
                      });
                    }}
                  >
                    {t('copyCredentials')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateUserCredentialsMutation.isPending}
                  >
                    {updateUserCredentialsMutation.isPending ? t('saving') : t('saveCredentials')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCredentialsModal(false)}>
                    {t('close')}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingCredentialUpdate}
        onOpenChange={(open) => !open && setPendingCredentialUpdate(null)}
        title={t('confirmCredentialsUpdateTitle')}
        description={`${t('confirmCredentialsUpdateDescription')} ${userCredentials?.fullName || ''}`}
        confirmLabel={t('saveCredentials')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (userCredentials?.id && pendingCredentialUpdate) {
            updateUserCredentialsMutation.mutate({
              userId: userCredentials.id,
              data: pendingCredentialUpdate,
            });
            setPendingCredentialUpdate(null);
          }
        }}
        variant="destructive"
      />

      <ConfirmDialog
        open={!!passwordResetUser}
        onOpenChange={(open) => !open && setPasswordResetUser(null)}
        title={t('confirmPasswordResetTitle')}
        description={`${t('confirmPasswordResetDescription')} ${passwordResetUser?.fullName || ''}`}
        confirmLabel={t('resetPassword')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (passwordResetUser?.id) {
            resetUserPasswordMutation.mutate(passwordResetUser.id);
            setPasswordResetUser(null);
          }
        }}
        variant="destructive"
      />

      <EmployeeArchiveDialogs
        archiveTarget={userToArchive}
        restoreTarget={userToRestore}
        onArchiveOpenChange={(open) => { if (!open) setUserToArchive(null); }}
        onRestoreOpenChange={(open) => { if (!open) setUserToRestore(null); }}
        onArchive={archiveEmployeeAfterImpactCheck}
        onRestore={(employee) => restoreUserMutation.mutate(employee.id)}
      />

      {/* Delete User Confirmation */}
      <ConfirmDialog
        open={!!userToDelete}
        onOpenChange={(open) => !open && setUserToDelete(null)}
        title={t('areYouSureDeleteUser')}
        description={`${t('areYouSureDeleteUser')} "${userToDelete?.fullName}"? ${t('thisActionCannotBeUndone')}`}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (userToDelete) {
            const employee = userToDelete;
            void getAssignedResponsibilityCount(employee, true)
              .then((leadCount) => {
                if (leadCount > 0) {
                  openLeadTransferDialog({ user: employee, action: 'delete', leadCount });
                  return;
                }
                deleteUserMutation.mutate({ id: employee.id });
              })
              .catch((error: Error) => {
                toast({
                  title: t('error'),
                  description: error.message || t('failedDeleteUserDescription'),
                  variant: 'destructive',
                });
              });
          }
        }}
        variant="destructive"
      />
    </ModulePage>
  );
}
