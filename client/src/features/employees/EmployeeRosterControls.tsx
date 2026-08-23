import { Archive, ArchiveRestore, Clock, Edit, Key, Search, Trash2, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/useTranslation';

type EmployeeListView = 'current' | 'archive';

type ModuleOption = {
  value: string;
  label: string;
};

type EmployeeActionTarget = {
  id: number;
  isArchived?: boolean;
};

export function EmployeeRowActions({
  employee,
  currentUserId,
  onCredentials,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  employee: EmployeeActionTarget;
  currentUserId?: number | null;
  onCredentials: (employee: EmployeeActionTarget) => void;
  onEdit: (employee: EmployeeActionTarget) => void;
  onArchive: (employee: EmployeeActionTarget) => void;
  onRestore: (employee: EmployeeActionTarget) => void;
  onDelete: (employee: EmployeeActionTarget) => void;
}) {
  const { t } = useTranslation();
  const isCurrentUser = Number(employee.id) === Number(currentUserId);
  const credentialsLabel = t('viewCredentials');
  const editLabel = t('editUser');
  const archiveLabel = isCurrentUser ? t('cannotArchiveOwnAccount') : t('archiveEmployee');
  const restoreLabel = t('restoreEmployee');
  const deleteLabel = isCurrentUser ? t('cannotDeleteOwnAccount') : t('deleteUser');

  return (
    <div className="flex items-center justify-end space-x-2">
      {employee.isArchived ? (
        <Button variant="ghost" size="sm" onClick={() => onRestore(employee)} title={restoreLabel} aria-label={restoreLabel}>
          <ArchiveRestore className="h-3 w-3" />
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => onCredentials(employee)} title={credentialsLabel} aria-label={credentialsLabel}>
            <Key className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit(employee)} title={editLabel} aria-label={editLabel}>
            <Edit className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onArchive(employee)}
            disabled={isCurrentUser}
            title={archiveLabel}
            aria-label={archiveLabel}
          >
            <Archive className="h-3 w-3" />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(employee)}
        disabled={isCurrentUser}
        className="text-red-600 hover:text-red-800"
        title={deleteLabel}
        aria-label={deleteLabel}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function EmployeeRosterControls({
  activeCount,
  inactiveCount,
  archivedCount,
  snapshotTime,
  view,
  onViewChange,
  searchTerm,
  onSearchTermChange,
  moduleFilter,
  onModuleFilterChange,
  moduleOptions,
}: {
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
  snapshotTime: string;
  view: EmployeeListView;
  onViewChange: (view: EmployeeListView) => void;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  moduleFilter: string;
  onModuleFilterChange: (value: string) => void;
  moduleOptions: readonly ModuleOption[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="hover-lift">
          <CardContent className="flex items-center space-x-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{t('activeUsers')}</p>
              <p className="text-lg font-bold tabular-nums text-foreground">{activeCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="hover-lift">
          <CardContent className="flex items-center space-x-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/30">
              <UserX className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{t('inactiveUsers')}</p>
              <p className="text-lg font-bold tabular-nums text-foreground">{inactiveCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="hover-lift">
          <CardContent className="flex items-center space-x-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900">
              <Archive className="h-5 w-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{t('archivedEmployees')}</p>
              <p className="text-lg font-bold tabular-nums text-foreground">{archivedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="hover-lift">
          <CardContent className="flex items-center space-x-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{t('lastUpdated')}</p>
              <p className="text-lg font-bold tabular-nums text-foreground">{snapshotTime}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <Tabs className="w-full lg:w-auto" value={view} onValueChange={(value) => onViewChange(value as EmployeeListView)}>
              <TabsList className="grid w-full grid-cols-2 lg:w-auto">
                <TabsTrigger value="current">
                  {t('currentEmployees')} ({activeCount + inactiveCount})
                </TabsTrigger>
                <TabsTrigger value="archive">
                  {t('archivedEmployees')} ({archivedCount})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('searchUsers')}
                value={searchTerm}
                onChange={(event) => onSearchTermChange(event.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={moduleFilter} onValueChange={onModuleFilterChange}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allModules')}</SelectItem>
                  {moduleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
