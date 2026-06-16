import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { canManageUsers } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Plus,
  Search,
  Settings,
  Users,
  Mail,
  Clock,
  Shield,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  Calendar,
  FileText,
  Key
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { devLog } from '@/lib/debug';
import ConfirmDialog from '@/components/ConfirmDialog';

// Schema functions that use runtime translation
const createUserSchema = (t: any) => z.object({
  email: z.string().email(t('invalidEmailAddress')),
  fullName: z.string().min(1, t('fullNameRequiredValidation')),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  position: z.string().optional(),
  role: z.enum(['admin', 'head', 'account_manager', 'teacher', 'operations_director', 'smm_manager', 'employee']),
  hasReportAccess: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const createSystemSettingSchema = (t: any) => z.object({
  key: z.string().min(1, t('settingKeyRequiredValidation')),
  value: z.string().min(1, t('settingValueRequiredValidation')),
  description: z.string().optional(),
});

const createAiSettingsSchema = (t: any) => z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  model: z.string().min(1, t('aiModelRequired')),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().default(false),
});

export default function Admin() {
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userCredentials, setUserCredentials] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('users');
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Create schemas with translations
  const userSchema = createUserSchema(t);
  const systemSettingSchema = createSystemSettingSchema(t);
  const aiSettingsSchema = createAiSettingsSchema(t);

  const userForm = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      fullName: '',
      phone: '',
      position: '',
      role: 'employee',
      hasReportAccess: false,
      isActive: true,
    },
  });

  const settingsForm = useForm<z.infer<typeof systemSettingSchema>>({
    resolver: zodResolver(systemSettingSchema),
    defaultValues: {
      key: '',
      value: '',
      description: '',
    },
  });

  const aiSettingsForm = useForm<z.infer<typeof aiSettingsSchema>>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: {
      provider: 'openai',
      model: '',
      baseUrl: '',
      apiKey: '',
      clearApiKey: false,
    },
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

  const { data: systemSettings = [], isLoading: settingsLoading } = useQuery<any[]>({
    queryKey: ['/api/system-settings'],
  });

  const { data: aiSettings, isLoading: aiSettingsLoading } = useQuery<any>({
    queryKey: ['/api/system-settings/ai'],
  });

  useEffect(() => {
    if (!aiSettings) {
      return;
    }

    aiSettingsForm.reset({
      provider: aiSettings.provider || 'openai',
      model: aiSettings.model || '',
      baseUrl: aiSettings.baseUrl || '',
      apiKey: '',
      clearApiKey: false,
    });
  }, [aiSettings, aiSettingsForm]);

  const activeUserCount = users.filter((user: any) => user.isActive).length;
  const inactiveUserCount = users.length - activeUserCount;
  const settingsCount = systemSettings.length;
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

  const updateSystemSettingMutation = useMutation({
    mutationFn: async (data: z.infer<ReturnType<typeof createSystemSettingSchema>>) => {
      return await apiRequest('POST', '/api/system-settings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/system-settings'] });
      toast({
        title: t('settingUpdatedSuccessfullyTitle'),
        description: t('systemSettingSavedDescription'),
      });
      settingsForm.reset();
      setShowSettingsModal(false);
    },
    onError: () => {
      toast({
        title: t('error'),
        description: t('failedUpdateSettingDescription'),
        variant: 'destructive',
      });
    },
  });

  const updateAiSettingsMutation = useMutation({
    mutationFn: async (data: z.infer<typeof aiSettingsSchema>) => {
      return apiRequest('PUT', '/api/system-settings/ai', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/system-settings/ai'] });
      toast({
        title: t('aiSettingsSavedTitle'),
        description: t('aiSettingsSavedDescription'),
      });
      aiSettingsForm.setValue('apiKey', '');
      aiSettingsForm.setValue('clearApiKey', false);
    },
    onError: (error: any) => {
      toast({
        title: t('error'),
        description: error.message || t('aiSettingsSaveFailed'),
        variant: 'destructive',
      });
    },
  });

  const fetchUserCredentials = async (userId: number) => {
    try {
      devLog('Fetching credentials for user ID:', userId);

      const credentials = await apiRequest('GET', `/api/users/${userId}/credentials`);
      devLog('Credentials received:', credentials);
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
    if (selectedUser) {
      updateUserMutation.mutate({ id: selectedUser.id, data });
    } else {
      createUserMutation.mutate(data);
    }
  };

  const onSubmitSetting = (data: z.infer<ReturnType<typeof createSystemSettingSchema>>) => {
    updateSystemSettingMutation.mutate(data);
  };

  const onSubmitAiSettings = (data: z.infer<ReturnType<typeof createAiSettingsSchema>>) => {
    updateAiSettingsMutation.mutate(data);
  };

  const openEditUserModal = (user: any) => {
    setSelectedUser(user);
    userForm.reset({
      email: user.email,
      fullName: user.fullName,
      phone: user.phone || '',
      position: user.position || '',
      role: user.role,
      hasReportAccess: user.hasReportAccess,
      isActive: user.isActive,
    });
    setShowCreateUserModal(true);
  };

  const closeUserModal = () => {
    setShowCreateUserModal(false);
    setSelectedUser(null);
    userForm.reset();
  };

  const filteredUsers = users.filter((user: any) => {
    const matchesSearch = user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
      case 'head':
        return 'bg-red-100 text-red-800';
      case 'operations_director':
        return 'bg-purple-100 text-purple-800';
      case 'account_manager':
        return 'bg-blue-100 text-blue-800';
      case 'teacher':
        return 'bg-amber-100 text-amber-800';
      case 'smm_manager':
        return 'bg-pink-100 text-pink-800';
      case 'employee':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return t('admin');
      case 'head':
        return t('roleHead');
      case 'account_manager':
        return t('roleAccountManager');
      case 'teacher':
        return t('roleTeacher');
      case 'operations_director':
        return t('roleOperationsDirector');
      case 'smm_manager':
        return t('roleSmmManager');
      case 'employee':
        return t('employee');
      default:
        return role;
    }
  };

  const getStatusColor = (isActive: boolean) => {
    return isActive
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-red-100 text-red-800';
  };

  const getSettingDescription = (key: string) => {
    switch (key) {
      case 'working_hours_start':
        return t('workingHoursStart');
      case 'working_hours_end':
        return t('workingHoursEnd');
      case 'lesson_duration':
        return t('lessonDuration');
      case 'reminder_time':
        return t('reminderTime');
      default:
        return key;
    }
  };

  const defaultSystemSettings = [
    {
      key: 'working_hours_start',
      value: '09:00',
      description: t('startOfWorkingHoursDescription'),
    },
    {
      key: 'working_hours_end',
      value: '17:00',
      description: t('endOfWorkingHoursDescription'),
    },
    {
      key: 'lesson_duration',
      value: '90',
      description: t('defaultLessonDurationDescription'),
    },
    {
      key: 'reminder_time',
      value: '30',
      description: t('paymentReminderTimeDescription'),
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('administration')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('adminDescription')}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="users" className="flex items-center space-x-2">
            <Users className="h-4 w-4" />
            <span>{t('userManagement')}</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center space-x-2">
            <Settings className="h-4 w-4" />
            <span>{t('systemSettings')}</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center space-x-2">
            <FileText className="h-4 w-4" />
            <span>{t('reportsLogs')}</span>
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          {/* User Management Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{t('userManagement')}</h2>
              <p className="text-sm text-slate-500">
                {t('createManageUserAccounts')}
              </p>
            </div>
            <Dialog open={showCreateUserModal} onOpenChange={setShowCreateUserModal}>
                <DialogTrigger asChild>
                  <Button className="bg-primary-600 hover:bg-primary-700">
                    <Plus className="h-4 w-4 mr-2" />
                    {t('addUser')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {selectedUser ? t('editUser') : t('addNewUser')}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="max-h-[70vh] overflow-y-auto pr-2">
                    <Form {...userForm}>
                      <form onSubmit={userForm.handleSubmit(onSubmitUser)} className="space-y-4">
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
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('email')}</FormLabel>
                                <FormControl>
                                  <Input type="email" placeholder={t('emailPlaceholder')} {...field} />
                                </FormControl>
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
                                  <Input type="tel" placeholder={t('phonePlaceholder')} {...field} />
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
                            name="role"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('role')}</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="employee">{t('employee')}</SelectItem>
                                    <SelectItem value="account_manager">{t('roleAccountManager')}</SelectItem>
                                    <SelectItem value="teacher">{t('roleTeacher')}</SelectItem>
                                    <SelectItem value="operations_director">{t('roleOperationsDirector')}</SelectItem>
                                    <SelectItem value="smm_manager">{t('roleSmmManager')}</SelectItem>
                                    <SelectItem value="head">{t('roleHead')}</SelectItem>
                                    <SelectItem value="admin">{t('admin')}</SelectItem>
                                  </SelectContent>
                                </Select>
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

                        <div className="space-y-4">
                          <FormField
                            control={userForm.control}
                            name="hasReportAccess"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">{t('reportsAccess')}</FormLabel>
                                  <div className="text-sm text-slate-500">
                                    {t('allowReportsAccess')}
                                  </div>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={userForm.control}
                            name="isActive"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">{t('activeAccount')}</FormLabel>
                                  <div className="text-sm text-slate-500">
                                    {t('canLoginAccess')}
                                  </div>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex items-center justify-end space-x-3 pt-4 border-t sticky bottom-0 bg-white">
                          <Button type="button" variant="outline" onClick={closeUserModal}>
                            {t('cancel')}
                          </Button>
                          <Button
                            type="submit"
                            disabled={createUserMutation.isPending || updateUserMutation.isPending}
                            className="bg-primary-600 hover:bg-primary-700"
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
                  </div>
                </DialogContent>
              </Dialog>
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
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allRoles')}</SelectItem>
                    <SelectItem value="admin">{t('administrators')}</SelectItem>
                    <SelectItem value="head">{t('roleHeads')}</SelectItem>
                    <SelectItem value="account_manager">{t('roleAccountManagers')}</SelectItem>
                    <SelectItem value="teacher">{t('roleTeachers')}</SelectItem>
                    <SelectItem value="operations_director">{t('roleOperationsDirectors')}</SelectItem>
                    <SelectItem value="smm_manager">{t('roleSmmManagers')}</SelectItem>
                    <SelectItem value="employee">{t('employees')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Users List */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200/70">
                    <tr>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('user')}
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('role')}
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('status')}
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('reportsAccess')}
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('created')}
                      </th>
                      <th className="px-6 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {t('actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {usersLoading ? (
                      Array.from({ length: 5 }, (_, i) => (
                        <tr key={i}>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              <Skeleton className="w-10 h-10 rounded-full" />
                              <div className="space-y-1">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-48" />
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4"><Skeleton className="h-6 w-20" /></td>
                          <td className="px-6 py-4"><Skeleton className="h-6 w-16" /></td>
                          <td className="px-6 py-4"><Skeleton className="h-4 w-4" /></td>
                          <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-6 py-4"><Skeleton className="h-8 w-16" /></td>
                        </tr>
                      ))
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center">
                          <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-slate-900 mb-2">{t('noUsersFound')}</h3>
                          <p className="text-slate-500 mb-4">
                            {searchTerm || roleFilter !== 'all'
                              ? t('adjustSearchCriteria')
                              : t('createFirstUser')}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user: any) => (
                        <tr key={user.id} className="hover:bg-primary/[0.035] transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                                   style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', boxShadow: 'var(--shadow-primary)' }}>
                                <span>
                                  {user.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                                </span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                                <p className="text-sm text-slate-500">{user.email}</p>
                                {user.position && (
                                  <p className="text-xs text-slate-400">{user.position}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge className={getRoleColor(user.role)}>
                              {getRoleLabel(user.role)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            <Badge className={getStatusColor(user.isActive)}>
                              {user.isActive ? t('active') : t('inactive')}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            {user.hasReportAccess ? (
                              <Eye className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <EyeOff className="h-4 w-4 text-slate-400" />
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : t('notAvailable')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => fetchUserCredentials(user.id)}
                                title={t('viewCredentials')}
                              >
                                <Key className="h-3 w-3" />
                              </Button>
                              <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditUserModal(user)}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setUserToDelete(user);
                                  }}
                                  className="text-red-600 hover:text-red-800"
                                  title={t('deleteUser')}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-semibold text-slate-900">{t('systemSettings')}</h2>
                <span className="text-xs text-slate-500">{settingsCount}</span>
              </div>
              <p className="text-sm text-slate-500">
                {t('configureSettings')}
              </p>
            </div>
            <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
                <DialogTrigger asChild>
                  <Button className="bg-primary-600 hover:bg-primary-700">
                    <Plus className="h-4 w-4 mr-2" />
                    {t('addSetting')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('addSystemSetting')}</DialogTitle>
                  </DialogHeader>
                  <Form {...settingsForm}>
                    <form onSubmit={settingsForm.handleSubmit(onSubmitSetting)} className="space-y-4">
                      <FormField
                        control={settingsForm.control}
                        name="key"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('settingKey')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('settingNamePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={settingsForm.control}
                        name="value"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('value')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('settingValuePlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={settingsForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('description')}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t('settingDescriptionPlaceholder')}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex items-center justify-end space-x-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShowSettingsModal(false)}
                        >
                          {t('cancel')}
                        </Button>
                        <Button
                          type="submit"
                          disabled={updateSystemSettingMutation.isPending}
                          className="bg-primary-600 hover:bg-primary-700"
                        >
                          {updateSystemSettingMutation.isPending ? t('saving') : t('saveSetting')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
          </div>

          <Card className="hover-lift">
            <CardHeader className="pb-4">
              <CardTitle>{t('aiSettings')}</CardTitle>
            </CardHeader>
            <CardContent>
              {aiSettingsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <Form {...aiSettingsForm}>
                  <form onSubmit={aiSettingsForm.handleSubmit(onSubmitAiSettings)} className="space-y-4">
                    <p className="text-sm text-slate-500">{t('aiSettingsDescription')}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={aiSettingsForm.control}
                        name="provider"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aiProvider')}</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="openai">{t('providerOpenAI')}</SelectItem>
                                <SelectItem value="anthropic">{t('providerAnthropic')}</SelectItem>
                                <SelectItem value="gemini">{t('providerGoogleGemini')}</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={aiSettingsForm.control}
                        name="model"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aiModel')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('aiModelPlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={aiSettingsForm.control}
                        name="baseUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aiBaseUrl')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('aiBaseUrlPlaceholder')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={aiSettingsForm.control}
                        name="apiKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aiApiKey')}</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder={aiSettings?.apiKeyMasked || t('aiApiKeyPlaceholder')}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-lg border p-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{t('aiApiKeyStored')}</p>
                        <p className="text-xs text-slate-500">
                          {aiSettings?.hasApiKey
                            ? `${t('currentKeyMasked')}: ${aiSettings.apiKeyMasked}`
                            : t('aiApiKeyMissing')}
                        </p>
                      </div>

                      <FormField
                        control={aiSettingsForm.control}
                        name="clearApiKey"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between gap-3">
                            <FormLabel>{t('clearStoredApiKey')}</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Badge className={aiSettings?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
                        {aiSettings?.configured ? t('aiConfigured') : t('aiNotConfigured')}
                      </Badge>
                      <Button type="submit" disabled={updateAiSettingsMutation.isPending}>
                        {updateAiSettingsMutation.isPending ? t('saving') : t('saveAiSettings')}
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>

          {/* Settings Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Academy Settings */}
            <Card className="hover-lift">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center space-x-2">
                  <Calendar className="h-5 w-5 text-primary-600" />
                  <span>{t('academySettings')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {settingsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-6 w-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  defaultSystemSettings.map((setting) => (
                    <div key={setting.key} className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">
                        {getSettingDescription(setting.key)}
                      </label>
                      <Input
                        defaultValue={setting.value}
                        className="text-sm"
                        placeholder={setting.value}
                      />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Email Settings */}
            <Card className="hover-lift">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center space-x-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  <span>{t('emailSettings')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t('smtpHost')}
                  </label>
                  <Input placeholder={t('smtpHostPlaceholder')} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t('smtpPort')}
                  </label>
                  <Input placeholder={t('smtpPortPlaceholder')} type="number" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t('fromEmail')}
                  </label>
                  <Input placeholder={t('fromEmailPlaceholder')} type="email" />
                </div>
              </CardContent>
            </Card>

            {/* Security Settings */}
            <Card className="hover-lift">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="h-5 w-5 text-emerald-600" />
                  <span>{t('securitySettings')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t('sessionTimeout')}
                  </label>
                  <Input placeholder={t('sessionTimeoutPlaceholder')} type="number" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t('passwordMinLength')}
                  </label>
                  <Input placeholder={t('passwordMinLengthPlaceholder')} type="number" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    {t('require2FA')}
                  </label>
                  <Switch />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Save Settings */}
          <div className="flex justify-end">
            <Button className="bg-primary-600 hover:bg-primary-700">
              <Settings className="h-4 w-4 mr-2" />
              {t('saveAllSettings')}
            </Button>
          </div>
        </TabsContent>

        {/* Reports & Logs Tab */}
        <TabsContent value="reports" className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t('reportsActivityLogs')}</h2>
            <p className="text-sm text-slate-500">
              {t('viewSystemActivity')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* System Statistics */}
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
                    <span className="text-sm text-slate-600">{t('administrators')}</span>
                    <span className="text-sm font-medium">
                      {users.filter((u: any) => u.role === 'admin').length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{t('accountManagers')}</span>
                    <span className="text-sm font-medium">
                      {users.filter((u: any) => u.role === 'account_manager').length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>{t('recentActivity')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-slate-500">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                  <p>{t('activityLogsWillAppear')}</p>
                  <p className="text-xs">{t('trackUserActions')}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Export Options */}
          <Card>
            <CardHeader>
              <CardTitle>{t('exportReports')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Button variant="outline" className="justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  {t('userReportPDF')}
                </Button>
                <Button variant="outline" className="justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  {t('activityLogCSV')}
                </Button>
                <Button variant="outline" className="justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  {t('systemSettingsJSON')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* User Credentials Modal */}
      <Dialog open={showCredentialsModal} onOpenChange={setShowCredentialsModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Key className="h-5 w-5" />
              <span>{t('userCredentials')}</span>
            </DialogTitle>
          </DialogHeader>
          {userCredentials && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('fullNameLabel')}</label>
                <div className="p-3 bg-slate-50 rounded-md text-sm">
                  {userCredentials.fullName}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('emailLogin')}</label>
                <div className="p-3 bg-slate-50 rounded-md text-sm font-mono">
                  {userCredentials.email}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('passwordLabel')}</label>
                <div className={`p-3 rounded-md text-sm font-mono ${userCredentials.temporaryPassword ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-500 italic'}`}>
                  {userCredentials.temporaryPassword || t('passwordNotAvailable')}
                </div>
                {!userCredentials.temporaryPassword && (
                  <p className="text-xs text-slate-500">
                    {t('passwordResetHint')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('positionLabel')}</label>
                <div className="p-3 bg-slate-50 rounded-md text-sm">
                  {userCredentials.position}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('roleLabel')}</label>
                <div className="p-3 bg-slate-50 rounded-md text-sm">
                  <Badge className={getRoleColor(userCredentials.role)}>
                    {getRoleLabel(userCredentials.role)}
                  </Badge>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                {userCredentials.id && (
                  <Button
                    variant="outline"
                    onClick={() => resetUserPasswordMutation.mutate(userCredentials.id)}
                    disabled={resetUserPasswordMutation.isPending}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    {resetUserPasswordMutation.isPending ? t('resettingPassword') : t('resetPassword')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    const credentialLines = [`Email: ${userCredentials.email}`];
                    if (userCredentials.temporaryPassword) {
                      credentialLines.push(`Password: ${userCredentials.temporaryPassword}`);
                    }
                    navigator.clipboard.writeText(credentialLines.join('\n'));
                    toast({
                      title: t('copiedToClipboard'),
                      description: t('credentialsCopied'),
                    });
                  }}
                >
                  {t('copyCredentials')}
                </Button>
                <Button onClick={() => setShowCredentialsModal(false)}>
                  {t('close')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
