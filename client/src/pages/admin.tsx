import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { canManageUsers, formatUserWorkspace } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { PhoneInput } from '@/components/ux/FormattedInputs';
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
  Search,
  Users,
  Clock,
  Shield,
  Edit,
  Trash2,
  UserCheck,
  UserX,
  Key,
  ArrowRight,
  Plug,
  SlidersHorizontal,
  KanbanSquare,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { devLog } from '@/lib/debug';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ACADEMY_WORKSPACES, getAssignedWorkspaces, type AcademyWorkspace } from '@shared/academy';

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
  workspace: z.enum(ACADEMY_WORKSPACES),
  workspaces: z.array(z.enum(ACADEMY_WORKSPACES)).min(1, t('selectAtLeastOneWorkspace')),
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
  } else if (values.password.length < 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('passwordTooShort'),
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
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userCredentials, setUserCredentials] = useState<any>(null);
  const [pendingCredentialUpdate, setPendingCredentialUpdate] = useState<z.infer<ReturnType<typeof createCredentialsSchema>> | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Create schemas with translations
  const userSchema = createUserSchema(t);
  const credentialsSchema = useMemo(() => createCredentialsSchema(t), [t]);
  const userForm = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      fullName: '',
      phone: '',
      dateOfBirth: '',
      position: '',
      workspace: 'sales',
      workspaces: ['sales'],
      isActive: true,
    },
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
      userForm.reset();
    }
  };
  const userDialogGuard = useUnsavedChangesGuard({
    open: showCreateUserModal,
    isDirty: userForm.formState.isDirty,
    onOpenChange: handleUserModalState,
  });

  // Check admin access
  if (!user || !canManageUsers(user)) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">{t('accessDenied')}</h3>
            <p className="text-slate-500">
              {t('noAdminPermission')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: users = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const activeUserCount = users.filter((user: any) => user.isActive).length;
  const inactiveUserCount = users.length - activeUserCount;
  const settingsSnapshotTime = new Date().toLocaleTimeString();

  const createUserMutation = useMutation({
    mutationFn: async (data: z.infer<ReturnType<typeof createUserSchema>>) => {
      return await apiRequest('POST', '/api/users', data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setUserCredentials(data);
      setShowCredentialsModal(true);
      toast({
        title: t('userCreatedSuccessfullyTitle'),
        description: t('newUserAddedDescription'),
      });
      userForm.reset();
      setShowCreateUserModal(false);
      setSelectedUser(null);
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
    mutationFn: async ({ id, data }: { id: number; data: Partial<z.infer<ReturnType<typeof createUserSchema>>> }) => {
      return await apiRequest('PUT', `/api/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('userUpdatedSuccessfullyTitle'),
        description: t('userInformationUpdatedDescription'),
      });
      setSelectedUser(null);
      setShowCreateUserModal(false);
    },
    onError: () => {
      toast({
        title: t('error'),
        description: t('failedUpdateUserDescription'),
        variant: 'destructive',
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('userDeletedSuccessfullyTitle'),
        description: t('userRemovedFromSystemDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedDeleteUserDescription'),
        variant: 'destructive',
      });
    },
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await apiRequest('POST', `/api/users/${userId}/reset-password`);
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
      return await apiRequest('PATCH', `/api/users/${userId}/credentials`, data);
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

      const credentials = await apiRequest('GET', `/api/users/${userId}/credentials`);
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

  const onSubmitUser = (data: z.infer<ReturnType<typeof createUserSchema>>) => {
    const workspaces = Array.from(new Set([data.workspace, ...data.workspaces]));
    const payload = {
      ...data,
      workspaces,
    };

    if (selectedUser) {
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
      workspace: user.workspace,
      workspaces: getAssignedWorkspaces(user),
      isActive: user.isActive,
    });
    setShowCreateUserModal(true);
  };

  const filteredUsers = users.filter((user: any) => {
    const matchesSearch = user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesWorkspace = workspaceFilter === 'all' ||
      getAssignedWorkspaces(user).includes(workspaceFilter as AcademyWorkspace);
    return matchesSearch && matchesWorkspace;
  });

  const getWorkspaceColor = (workspace: string) => {
    switch (workspace) {
      case 'administration':
        return 'bg-red-100 text-red-800';
      case 'sales':
        return 'bg-blue-100 text-blue-800';
      case 'teacher':
        return 'bg-amber-100 text-amber-800';
      case 'marketing':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  const getWorkspaceLabel = (workspace: string) => formatUserWorkspace(workspace, t);
  const getWorkspaceLabels = (user: any) => getAssignedWorkspaces(user).map(getWorkspaceLabel);

  const getStatusColor = (isActive: boolean) => {
    return isActive
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-red-100 text-red-800';
  };

  const workspaceOptions = [
    { value: 'administration', label: t('administrationWorkspace') },
    { value: 'sales', label: t('salesDepartmentWorkspace') },
    { value: 'teacher', label: t('teacherDepartmentWorkspace') },
    { value: 'marketing', label: t('marketingDepartmentWorkspace') },
  ] as const;
  const primaryWorkspaceValue = userForm.watch('workspace');

  const administrationSections = [
    {
      href: '/employees',
      icon: Users,
      title: t('employees'),
      description: t('adminEmployeesDescription'),
    },
    {
      href: '/tasks',
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
            style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', boxShadow: 'var(--shadow-primary)' }}
          >
            <span>
              {row.fullName.split(' ').map((name: string) => name[0]).join('').slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{row.fullName}</p>
            <p className="text-sm text-slate-500 truncate">{row.email}</p>
            {row.position && <p className="text-xs text-slate-400 truncate">{row.position}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'workspace',
      header: t('workspaceModules'),
      sortable: true,
      accessor: (row) => getWorkspaceLabels(row).join(' '),
      render: (row) => (
        <div className="flex max-w-sm flex-wrap gap-1.5">
          <Badge className={getWorkspaceColor(row.workspace)}>
            {getWorkspaceLabel(row.workspace)}
          </Badge>
          {getAssignedWorkspaces(row)
            .filter((workspace) => workspace !== row.workspace)
            .map((workspace) => (
              <Badge key={workspace} variant="outline" className={getWorkspaceColor(workspace)}>
                {getWorkspaceLabel(workspace)}
              </Badge>
            ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (row) => row.isActive ? t('active') : t('inactive'),
      render: (row) => (
        <Badge className={getStatusColor(row.isActive)}>
          {row.isActive ? t('active') : t('inactive')}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: t('created'),
      sortable: true,
      accessor: (row) => row.createdAt ? new Date(row.createdAt).getTime() : 0,
      render: (row) => (
        <span className="text-sm text-slate-500">
          {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : t('notAvailable')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      cellClassName: 'text-right',
      render: (row) => (
        <div className="flex items-center justify-end space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchUserCredentials(row.id)}
            title={t('viewCredentials')}
          >
            <Key className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEditUserModal(row)}>
            <Edit className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUserToDelete(row)}
            className="text-red-600 hover:text-red-800"
            title={t('deleteUser')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={isEmployeesPage ? t('employees') : t('administration')}
        subtitle={isEmployeesPage ? t('employeesPageSubtitle') : t('adminControlCenterSubtitle')}
        breadcrumbs={isEmployeesPage
          ? [{ label: t('adminDashboardTitle'), href: '/admin' }, { label: t('employees') }]
          : [{ label: t('administration') }]}
        actions={isEmployeesPage ? (
          <Button
            className="bg-primary-600 hover:bg-primary-700"
            onClick={() => {
              setShowCreateUserModal(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('createEmployee')}
          </Button>
        ) : undefined}
      />

      <Tabs value={isEmployeesPage ? 'users' : 'reports'} className="space-y-6">
        {/* Users Tab */}
        {isEmployeesPage && (
        <TabsContent value="users" className="space-y-6">
          {/* User Management Header */}
          <div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{t('userManagement')}</h2>
              <p className="text-sm text-slate-500">
                {t('createManageUserAccounts')}
              </p>
            </div>
            <Dialog open={showCreateUserModal} onOpenChange={userDialogGuard.handleOpenChange}>
                <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[90dvh]">
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
                      className="flex min-h-0 flex-1 flex-col"
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
                                  <p className="text-xs text-slate-500">{t('loginManagedInCredentials')}</p>
                                  <FormMessage />
                                </FormItem>
                              ) : (
                                <FormItem>
                                  <FormLabel>{t('loginLabel')}</FormLabel>
                                  <div className="rounded-lg border border-dashed border-border bg-muted/70 p-3">
                                    <p className="text-sm font-medium text-slate-700">{t('employeeLoginGenerated')}</p>
                                    <p className="mt-1 text-xs text-slate-500">{t('employeeLoginHint')}</p>
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={userForm.control}
                            name="workspace"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('primaryWorkspace')}</FormLabel>
                                <Select
                                  onValueChange={(value) => {
                                    const nextWorkspace = value as AcademyWorkspace;
                                    field.onChange(nextWorkspace);
                                    const currentWorkspaces = userForm.getValues('workspaces') ?? [];
                                    if (!currentWorkspaces.includes(nextWorkspace)) {
                                      userForm.setValue('workspaces', [...currentWorkspaces, nextWorkspace], {
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
                                      {workspaceOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-slate-500">
                                  {t('workspaceAssignmentHint')}
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
                          name="workspaces"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('workspaceModules')}</FormLabel>
                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                                {workspaceOptions.map((option) => {
                                  const value = option.value;
                                  const checked = (field.value ?? []).includes(value);
                                  const isPrimary = primaryWorkspaceValue === value;

                                  return (
                                    <label
                                      key={value}
                                      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                                    >
                                      <Checkbox
                                        checked={checked || isPrimary}
                                        disabled={isPrimary}
                                        onCheckedChange={(nextChecked) => {
                                          const currentWorkspaces = field.value ?? [];
                                          if (nextChecked) {
                                            field.onChange([...new Set([...currentWorkspaces, value])]);
                                            return;
                                          }

                                          field.onChange(currentWorkspaces.filter((workspace) => workspace !== value));
                                        }}
                                      />
                                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                      {isPrimary && (
                                        <span className="shrink-0 text-xs text-slate-500">{t('primaryWorkspaceShort')}</span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                              <p className="text-xs text-slate-500">{t('workspaceModulesHint')}</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={userForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
                              <div className="min-w-0 space-y-0.5">
                                <FormLabel className="text-base">{t('activeAccount')}</FormLabel>
                                <div className="text-sm text-slate-500">
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="hover-lift">
              <CardContent className="p-4 flex items-center space-x-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                  <UserCheck className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 truncate">{t('activeUsers')}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{activeUserCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-lift">
              <CardContent className="p-4 flex items-center space-x-3">
                <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <UserX className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 truncate">{t('inactiveUsers')}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{inactiveUserCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-lift">
              <CardContent className="p-4 flex items-center space-x-3">
                <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Clock className="h-5 w-5 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 truncate">{t('lastUpdated')}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{settingsSnapshotTime}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* User Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder={t('searchUsers')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">{t('allWorkspaces')}</SelectItem>
                      {workspaceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

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
                      <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-slate-900 mb-2">{t('noUsersFound')}</h3>
                      <p className="text-slate-500 mb-4">
                        {searchTerm || workspaceFilter !== 'all'
                          ? t('adjustSearchCriteria')
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
                          <h2 className="font-semibold text-slate-900">{section.title}</h2>
                          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{section.description}</p>
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
                  <span className="text-sm text-slate-600">{t('administrationWorkspace')}</span>
                  <span className="text-sm font-medium">
                    {users.filter((u: any) => getAssignedWorkspaces(u).includes('administration')).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">{t('salesDepartmentWorkspace')}</span>
                  <span className="text-sm font-medium">
                    {users.filter((u: any) => getAssignedWorkspaces(u).includes('sales')).length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                  <p className="text-sm font-medium text-slate-900">{userCredentials.fullName}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className={getWorkspaceColor(userCredentials.workspace)}>
                      {getWorkspaceLabel(userCredentials.workspace)}
                    </Badge>
                    {getAssignedWorkspaces(userCredentials)
                      .filter((workspace) => workspace !== userCredentials.workspace)
                      .map((workspace) => (
                        <Badge key={workspace} variant="outline" className={getWorkspaceColor(workspace)}>
                          {getWorkspaceLabel(workspace)}
                        </Badge>
                      ))}
                    {userCredentials.position && (
                      <span className="text-xs text-slate-500">{userCredentials.position}</span>
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
                  <label className="text-sm font-medium text-slate-700">{t('password')}</label>
                  <div className={`min-w-0 break-all rounded-md p-3 font-mono text-sm ${userCredentials.temporaryPassword ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-500 italic'}`}>
                    {userCredentials.temporaryPassword || t('passwordNotAvailable')}
                  </div>
                  <p className="text-xs text-slate-500">
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
                      credentialLines.push(`${t('primaryWorkspace')}: ${getWorkspaceLabel(userCredentials.workspace)}`);
                      credentialLines.push(`${t('workspaceModules')}: ${getWorkspaceLabels(userCredentials).join(', ')}`);
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
            deleteUserMutation.mutate(userToDelete.id);
            setUserToDelete(null);
          }
        }}
        variant="destructive"
      />
    </div>
  );
}
