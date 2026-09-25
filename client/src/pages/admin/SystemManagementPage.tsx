import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BellRing,
  Loader2,
  MessageCircle,
  Plug,
  Search,
  Send,
  Users,
} from 'lucide-react';
import type { EmployeeBroadcastRequest } from '@shared/contracts/employee-broadcast';
import {
  ACADEMY_ACCESS_MODULES,
  getAssignedModules,
  type AcademyAccessModule,
} from '@shared/academy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { formatUserModule, getInitials } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { MODULE_NAVIGATION } from '@/lib/moduleNavigation';
import { messageQueryKeys } from '@/features/messages/api';
import { sendEmployeeBroadcast } from '@/features/employee-broadcast/api';

type SystemManagementSection = 'overview' | 'employee-notifications';
type BroadcastChannel = EmployeeBroadcastRequest['channel'];

interface SystemManagementPageProps {
  section?: SystemManagementSection;
}

interface BroadcastEmployee {
  id: number;
  fullName: string;
  email?: string | null;
  position?: string | null;
  module: string;
  modules?: AcademyAccessModule[] | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

function SystemManagementOverview() {
  const { t } = useTranslation();
  const sections = [
    {
      href: '/admin/system-management/integrations',
      icon: Plug,
      title: t('navIntegrations'),
      description: t('adminIntegrationsDescription'),
    },
    {
      href: '/admin/system-management/employee-notifications',
      icon: BellRing,
      title: t('employeeNotifications'),
      description: t('employeeNotificationsDescription'),
    },
  ];

  return (
    <ModulePage>
      <PageHeader
        title={t('systemManagement')}
        subtitle={t('systemManagementSubtitle')}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.administration.nameKey), href: '/admin' },
          { label: t('systemManagement') },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card interactive className="h-full">
                <CardContent className="flex h-full items-start gap-4 p-5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-semibold text-foreground">{section.title}</h2>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </ModulePage>
  );
}

function EmployeeNotificationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<BroadcastChannel>('notification');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<AcademyAccessModule | 'all'>('all');
  const [composeOpen, setComposeOpen] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState('');
  const [content, setContent] = useState('');

  const employeesQuery = useQuery<BroadcastEmployee[]>({
    queryKey: ['/api/users'],
  });
  const employees = useMemo(() => (employeesQuery.data ?? []).filter((employee) => (
    (channel === 'notification' || employee.id !== user?.id)
    && employee.isActive === true
    && employee.isArchived !== true
  )), [channel, employeesQuery.data, user?.id]);
  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const selectedEmployees = useMemo(() => (
    [...selectedRecipientIds]
      .map((id) => employeesById.get(id))
      .filter((employee): employee is BroadcastEmployee => Boolean(employee))
  ), [employeesById, selectedRecipientIds]);
  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return employees.filter((employee) => {
      const matchesModule = moduleFilter === 'all'
        || getAssignedModules(employee).includes(moduleFilter);
      if (!matchesModule) return false;
      if (!normalizedSearch) return true;
      return [employee.fullName, employee.email, employee.position]
        .some((value) => String(value ?? '').toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [employees, moduleFilter, search]);
  const selectedFilteredCount = filteredEmployees.reduce(
    (count, employee) => count + Number(selectedRecipientIds.has(employee.id)),
    0,
  );
  const allFilteredSelected = filteredEmployees.length > 0
    && selectedFilteredCount === filteredEmployees.length;

  const sendMutation = useMutation({
    mutationFn: sendEmployeeBroadcast,
    onSuccess: (result, broadcast) => {
      if (result.channel === 'message') {
        queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
      } else if (user && broadcast.recipientIds.includes(user.id)) {
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      }
      toast({
        title: t('employeeBroadcastSentTitle'),
        description: t('employeeBroadcastSentDescription')
          .replace('{count}', String(result.sentCount)),
      });
      setComposeOpen(false);
      setSelectedRecipientIds(new Set());
      setNotificationTitle('');
      setContent('');
    },
    onError: (error: Error) => {
      toast({
        title: t('employeeBroadcastFailedTitle'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const setRecipientSelected = (employeeId: number, checked: boolean) => {
    setSelectedRecipientIds((current) => {
      const next = new Set(current);
      if (checked) next.add(employeeId);
      else next.delete(employeeId);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedRecipientIds((current) => {
      const next = new Set(current);
      for (const employee of filteredEmployees) {
        if (allFilteredSelected) next.delete(employee.id);
        else next.add(employee.id);
      }
      return next;
    });
  };

  const canSubmit = selectedEmployees.length > 0
    && content.trim().length > 0
    && (channel === 'message' || notificationTitle.trim().length > 0);

  const submitBroadcast = () => {
    if (!canSubmit || sendMutation.isPending) return;
    const common = {
      recipientIds: selectedEmployees.map((employee) => employee.id),
      content: content.trim(),
    };
    sendMutation.mutate(channel === 'notification'
      ? { channel, ...common, title: notificationTitle.trim() }
      : { channel, ...common });
  };

  return (
    <ModulePage>
      <PageHeader
        title={t('employeeNotifications')}
        subtitle={t('employeeNotificationsSubtitle')}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.administration.nameKey), href: '/admin' },
          { label: t('systemManagement'), href: '/admin/system-management' },
          { label: t('employeeNotifications') },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="gap-4">
            <div>
              <CardTitle>{t('broadcastRecipients')}</CardTitle>
              <CardDescription className="mt-1">
                {t('selectedEmployeesCount').replace('{count}', String(selectedEmployees.length))}
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('searchEmployees')}
                  aria-label={t('searchEmployees')}
                  className="pl-9"
                />
              </div>
              <Select
                value={moduleFilter}
                onValueChange={(value) => setModuleFilter(value as AcademyAccessModule | 'all')}
              >
                <SelectTrigger aria-label={t('employeeModuleFilter')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allModules')}</SelectItem>
                  {ACADEMY_ACCESS_MODULES.map((module) => (
                    <SelectItem key={module} value={module}>
                      {formatUserModule(module, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent>
            {employeesQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t('failedToLoadData')}</AlertTitle>
                <AlertDescription className="mt-3 flex items-center justify-between gap-3">
                  <span>{t('employeeListLoadError')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => employeesQuery.refetch()}
                    disabled={employeesQuery.isFetching}
                  >
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : employeesQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="py-12 text-center">
                <Users className="mx-auto size-10 text-muted-foreground/50" />
                <p className="mt-3 font-medium text-foreground">{t('noEmployeesFound')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('adjustSearchCriteria')}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border/70">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="select-all-broadcast-employees"
                      checked={allFilteredSelected
                        ? true
                        : selectedFilteredCount > 0
                          ? 'indeterminate'
                          : false}
                      onCheckedChange={toggleAllFiltered}
                      aria-label={t('selectAllFoundEmployees')}
                    />
                    <Label htmlFor="select-all-broadcast-employees">
                      {t('selectAllFoundEmployees')}
                    </Label>
                  </div>
                  {selectedEmployees.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRecipientIds(new Set())}
                    >
                      {t('clearSelection')}
                    </Button>
                  ) : null}
                </div>

                <div
                  className="max-h-[32rem] divide-y divide-border/60 overflow-y-auto"
                  role="group"
                  aria-label={t('broadcastRecipients')}
                >
                  {filteredEmployees.map((employee) => {
                    const checkboxId = `broadcast-employee-${employee.id}`;
                    const assignedModules = getAssignedModules(employee);
                    return (
                      <div key={employee.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/25">
                        <Checkbox
                          id={checkboxId}
                          checked={selectedRecipientIds.has(employee.id)}
                          onCheckedChange={(checked) => setRecipientSelected(employee.id, checked === true)}
                          aria-label={t('selectEmployeeForBroadcast').replace('{name}', employee.fullName)}
                        />
                        <Label htmlFor={checkboxId} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {getInitials(employee.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {employee.fullName}
                            </span>
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              {employee.position || employee.email || formatUserModule(employee.module, t)}
                            </span>
                          </span>
                          <span className="hidden max-w-[45%] flex-wrap justify-end gap-1 sm:flex">
                            {assignedModules.map((module) => (
                              <span
                                key={module}
                                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
                              >
                                {formatUserModule(module, t)}
                              </span>
                            ))}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('broadcastChannel')}</CardTitle>
              <CardDescription>{t('broadcastChannelDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <button
                type="button"
                aria-pressed={channel === 'notification'}
                onClick={() => setChannel('notification')}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  channel === 'notification'
                    ? 'border-primary bg-primary/5'
                    : 'border-border/70 hover:bg-muted/40',
                )}
              >
                <BellRing className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold text-foreground">{t('systemNotification')}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {t('systemNotificationDescription')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={channel === 'message'}
                onClick={() => {
                  setChannel('message');
                  if (user) setRecipientSelected(user.id, false);
                }}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  channel === 'message'
                    ? 'border-primary bg-primary/5'
                    : 'border-border/70 hover:bg-muted/40',
                )}
              >
                <MessageCircle className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold text-foreground">{t('personalMessage')}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {t('personalMessageDescription')}
                  </span>
                </span>
              </button>
            </CardContent>
          </Card>

          <Button
            type="button"
            className="w-full"
            disabled={selectedEmployees.length === 0}
            onClick={() => setComposeOpen(true)}
          >
            <Send className="size-4" />
            {t('composeEmployeeBroadcast')}
          </Button>
        </div>
      </div>

      <Dialog
        open={composeOpen}
        onOpenChange={(open) => {
          if (!sendMutation.isPending) setComposeOpen(open);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {channel === 'notification' ? t('composeSystemNotification') : t('composePersonalMessage')}
            </DialogTitle>
            <DialogDescription>
              {t('employeeBroadcastDialogDescription')
                .replace('{count}', String(selectedEmployees.length))}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2" aria-label={t('selectedRecipients')}>
              {selectedEmployees.slice(0, 4).map((employee) => (
                <Badge key={employee.id} variant="secondary">{employee.fullName}</Badge>
              ))}
              {selectedEmployees.length > 4 ? (
                <Badge variant="outline">
                  {t('moreEventsCount').replace('{count}', String(selectedEmployees.length - 4))}
                </Badge>
              ) : null}
            </div>

            {channel === 'notification' ? (
              <div className="space-y-2">
                <Label htmlFor="employee-broadcast-title">{t('notificationTitle')}</Label>
                <Input
                  id="employee-broadcast-title"
                  value={notificationTitle}
                  onChange={(event) => setNotificationTitle(event.target.value)}
                  placeholder={t('notificationTitlePlaceholder')}
                  maxLength={255}
                  autoFocus
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="employee-broadcast-content">{t('message')}</Label>
              <Textarea
                id="employee-broadcast-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={channel === 'notification'
                  ? t('systemNotificationPlaceholder')
                  : t('personalMessagePlaceholder')}
                maxLength={10_000}
                rows={7}
                autoFocus={channel === 'message'}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setComposeOpen(false)}
              disabled={sendMutation.isPending}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={submitBroadcast} disabled={!canSubmit || sendMutation.isPending}>
              {sendMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t('sendToSelectedEmployees').replace('{count}', String(selectedEmployees.length))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}

export default function SystemManagementPage({
  section = 'overview',
}: SystemManagementPageProps) {
  if (section === 'employee-notifications') return <EmployeeNotificationsPage />;
  return <SystemManagementOverview />;
}
