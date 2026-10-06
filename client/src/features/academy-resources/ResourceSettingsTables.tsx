import { useMemo } from 'react';
import { Archive, BookOpen, Building2, DoorOpen, Edit3, MapPin, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';
import { useTranslation } from '@/hooks/useTranslation';
import { type Course, type Room, type School } from './api';
import { useResourceArchive } from './useResourceArchive';
import { formatAcademyNumber } from '@/lib/localeFormat';

interface ResourceTableProps<T> {
  data: T[];
  archived: boolean;
  onArchiveChange: (archived: boolean) => void;
  onAdd: () => void;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
  onChanged: () => void | Promise<unknown>;
}

export function ArchiveSelect({ archived, onChange, label, currentFilterLabel }: { archived: boolean; onChange: (archived: boolean) => void; label?: string; currentFilterLabel?: string }) {
  const { t } = useTranslation();
  return <Select value={archived ? 'archive' : currentFilterLabel ? 'filtered' : 'current'} onValueChange={(value) => onChange(value === 'archive')}>
    <SelectTrigger className="w-44" aria-label={label || t('resourceListSection')}><SelectValue /></SelectTrigger>
    <SelectContent>
      {currentFilterLabel ? <SelectItem value="filtered">{currentFilterLabel}</SelectItem> : null}
      <SelectItem value="current">{t('resourcesNotArchived')}</SelectItem>
      <SelectItem value="archive">{t('taskArchive')}</SelectItem>
    </SelectContent>
  </Select>;
}

function ResourceStatus({ row }: { row: { isActive: boolean; isArchived?: boolean } }) {
  const { t } = useTranslation();
  return <Badge variant={!row.isArchived && row.isActive ? 'default' : 'secondary'}>
    {row.isArchived ? t('leadInArchive') : row.isActive ? t('active') : t('inactive')}
  </Badge>;
}

export function SchoolSettingsTable(props: ResourceTableProps<School>) {
  const { t } = useTranslation();
  const { mutation, openArchive, actionLabel: archiveActionLabel, dialogProps } = useResourceArchive<School>('schools', props.onChanged);
  const columns: DataTableColumn<School>[] = [
    { key: 'name', header: t('school'), sortable: true, accessor: (row) => row.name,
      render: (row) => <div className="min-w-0"><p className="truncate font-medium text-foreground">{row.name}</p><p className="truncate text-xs text-muted-foreground">{row.code}</p></div> },
    { key: 'address', header: t('address'), sortable: true, accessor: (row) => row.address,
      render: (row) => <div className="flex max-w-md items-center gap-2"><MapPin className="shrink-0 text-muted-foreground" /><span className="truncate">{row.address}</span></div> },
    { key: 'status', header: t('status'), accessor: (row) => row.isActive ? 1 : 0, render: (row) => <ResourceStatus row={row} /> },
    { key: 'actions', header: t('actions'), render: (row) => <div className="flex justify-end gap-1">
      {!row.isArchived ? <Button variant="ghost" size="icon" onClick={() => props.onEdit(row)} aria-label={t('edit')}><Edit3 /></Button> : null}
      <Button variant="ghost" size="icon" onClick={() => openArchive(row)} disabled={mutation.isPending}
        title={archiveActionLabel(row.isArchived)} aria-label={archiveActionLabel(row.isArchived)}>
        {row.isArchived ? <RotateCcw /> : <Archive />}
      </Button>
      <Button variant="ghost" size="icon" onClick={() => props.onDelete(row)} aria-label={t('delete')}><Trash2 /></Button>
    </div> },
  ];
  return <>
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3"><CardTitle>{t('schools')}</CardTitle><ArchiveSelect archived={props.archived} onChange={props.onArchiveChange} /></div>
        {!props.archived ? <Button onClick={props.onAdd}><Plus data-icon="inline-start" />{t('addSchool')}</Button> : null}
      </CardHeader>
      <CardContent className="p-0"><DataTable className="overflow-x-auto" columns={columns}
        data={props.data.filter((row) => Boolean(row.isArchived) === props.archived)} keyExtractor={(row) => `school-${row.id}`}
        defaultSortKey="name" emptyState={<EmptyState icon={Building2} title={t('noSchools')} />} /></CardContent>
    </Card>
    <ConfirmDialog {...dialogProps} />
  </>;
}

export function RoomSettingsTable(props: ResourceTableProps<Room> & { schools: School[] }) {
  const { t } = useTranslation();
  const { mutation, openArchive, actionLabel, dialogProps } = useResourceArchive<Room>('rooms', props.onChanged);
  const schoolNames = useMemo(() => new Map(props.schools.map((school) => [school.id, school.name])), [props.schools]);
  const schoolName = (id: number) => schoolNames.get(id) ?? '—';
  const columns: DataTableColumn<Room>[] = [
    { key: 'name', header: t('room'), sortable: true, accessor: (row) => row.name,
      render: (row) => <div className="flex items-center gap-2 font-medium text-foreground"><DoorOpen />{row.name}</div> },
    { key: 'school', header: t('school'), sortable: true, accessor: (row) => schoolName(row.schoolId),
      render: (row) => <span className="text-muted-foreground">{schoolName(row.schoolId)}</span> },
    { key: 'capacity', header: t('roomCapacity'), sortable: true, accessor: (row) => row.capacity, render: (row) => `${row.capacity} ${t('students')}` },
    { key: 'status', header: t('status'), accessor: (row) => row.isActive ? 1 : 0, render: (row) => <ResourceStatus row={row} /> },
    { key: 'actions', header: t('actions'), render: (row) => <div className="flex justify-end gap-1">
      {!row.isArchived ? <Button variant="ghost" size="icon" onClick={() => props.onEdit(row)} aria-label={t('edit')}><Edit3 /></Button> : null}
      <Button variant="ghost" size="icon" onClick={() => openArchive(row)} disabled={mutation.isPending} title={actionLabel(row.isArchived)} aria-label={actionLabel(row.isArchived)}>{row.isArchived ? <RotateCcw /> : <Archive />}</Button>
      <Button variant="ghost" size="icon" onClick={() => props.onDelete(row)} aria-label={t('delete')}><Trash2 /></Button>
    </div> },
  ];
  return <><Card>
    <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3"><CardTitle>{t('rooms')}</CardTitle><ArchiveSelect archived={props.archived} onChange={props.onArchiveChange} /></div>
      {!props.archived ? <Button onClick={props.onAdd}><Plus data-icon="inline-start" />{t('addRoom')}</Button> : null}
    </CardHeader>
    <CardContent className="p-0"><DataTable className="overflow-x-auto" columns={columns}
      data={props.data.filter((row) => Boolean(row.isArchived) === props.archived)} keyExtractor={(row) => `room-${row.id}`}
      defaultSortKey="name" emptyState={<EmptyState icon={DoorOpen} title={t('noRooms')} />} /></CardContent>
  </Card><ConfirmDialog {...dialogProps} /></>;
}


export function CourseSettingsTable(props: ResourceTableProps<Course>) {
  const { t, language } = useTranslation();
  const { mutation, openArchive, actionLabel, dialogProps } = useResourceArchive<Course>('courses', props.onChanged);
  const columns: DataTableColumn<Course>[] = [
    { key: 'name', header: t('course'), sortable: true, accessor: (row) => row.name,
      render: (row) => <div><p className="font-medium text-foreground">{row.name}</p><p className="text-xs text-muted-foreground">{row.ageCategory}</p></div> },
    { key: 'basePrice', header: t('basePrice'), sortable: true, accessor: (row) => row.basePriceUzs,
      render: (row) => `${formatAcademyNumber(row.basePriceUzs, language)}${t('uzs')}` },
    { key: 'status', header: t('status'), accessor: (row) => row.isActive ? 1 : 0, render: (row) => <ResourceStatus row={row} /> },
    { key: 'actions', header: t('actions'), render: (row) => <div className="flex justify-end gap-1">
      {!row.isArchived ? <Button variant="ghost" size="icon" onClick={() => props.onEdit(row)} aria-label={t('edit')}><Edit3 /></Button> : null}
      <Button variant="ghost" size="icon" onClick={() => openArchive(row)} disabled={mutation.isPending} title={actionLabel(row.isArchived)} aria-label={actionLabel(row.isArchived)}>{row.isArchived ? <RotateCcw /> : <Archive />}</Button>
      <Button variant="ghost" size="icon" onClick={() => props.onDelete(row)} aria-label={t('delete')}><Trash2 /></Button>
    </div> },
  ];
  return <><Card>
    <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3"><CardTitle>{t('courses')}</CardTitle><ArchiveSelect archived={props.archived} onChange={props.onArchiveChange} /></div>
      {!props.archived ? <Button onClick={props.onAdd}><Plus data-icon="inline-start" />{t('addCourse')}</Button> : null}
    </CardHeader>
    <CardContent className="p-0"><DataTable className="overflow-x-auto" columns={columns}
      data={props.data.filter((row) => Boolean(row.isArchived) === props.archived)} keyExtractor={(row) => `course-${row.id}`}
      defaultSortKey="name" emptyState={<EmptyState icon={BookOpen} title={t('noCourses')} />} /></CardContent>
  </Card><ConfirmDialog {...dialogProps} /></>;
}
