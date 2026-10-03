import { ACADEMY_ACCESS_MODULES, LEAD_ARCHIVE_REASONS, LEAD_STATUSES } from '@shared/academy';
import { formatUserModule } from '@/lib/auth';
import type { Language, TranslationKey } from '@/lib/i18n';
import { formatAcademyDate } from '@/lib/localeFormat';
import { groupStatusLabelKey, lessonStatusLabelKey } from '@/lib/teacherModule';

type Translate = (key: TranslationKey) => string;
const fieldKeys: Record<string, TranslationKey> = {
  fullnameKey: 'fullName',
  emailKey: 'email',
  phoneKey: 'phone',
  contactnameKey: 'contactPersonName',
  studentnameKey: 'studentName',
  studentageKey: 'ageLabel',
  nameKey: 'name',
  titleKey: 'name',
  descriptionKey: 'description',
  addressKey: 'address',
  amountKey: 'amount',
  amountuzsKey: 'amount',
  expectedpaymentuzsKey: 'expectedPayment',
  statusKey: 'status',
  learningstatusKey: 'studentLearningStatus',
  archivereasonKey: 'archiveReason',
  churnreasonKey: 'studentChurnReason',
  noteKey: 'commentsLabel',
  reasonKey: 'rescheduleReason',
  topicKey: 'lessonTopic',
  startdateKey: 'startDate',
  enddateKey: 'endDate',
  scheduledatKey: 'dateColumn',
  createdatKey: 'dateColumn',
  updatedatKey: 'lastUpdated',
  isactiveKey: 'active',
  isarchivedKey: 'groupArchivedShort',
  maxstudentsKey: 'groupCapacity',
  lessondurationminutesKey: 'lessonDurationMinutes',
  durationminutesKey: 'lessonDurationMinutes',
  moduleKey: 'primaryModule',
  modulesKey: 'accessModules',
  manageridKey: 'responsibleManager',
  teacheridKey: 'teacher',
  teacheruseridKey: 'teacher',
} satisfies Record<string, TranslationKey>;
const fieldName = (field: string) => field.replace(/_/g, '').toLowerCase();
export const auditFieldLabel = (field: string, t: Translate) => {
  const key = fieldKeys[`${fieldName(field)}Key`];
  return key ? t(key) : t('field');
};

export const auditVisibleFields = (oldValues: Record<string, unknown>, newValues: Record<string, unknown>) => (
  [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])].filter((field) => {
    const name = fieldName(field);
    if (!fieldKeys[`${name}Key`]) return false;
    const value = newValues[field] ?? oldValues[field];
    return name === 'modules' || value === null || value === undefined || typeof value !== 'object';
  })
);

export const auditValue = (field: string, value: unknown, context: {
  t: Translate; language: Language; entity: string;
  employees: Array<{ id: number; fullName: string }>;
}): string => {
  const { t, language, entity, employees } = context;
  const name = fieldName(field);
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
  if (['managerid', 'teacherid', 'teacheruserid'].includes(name)) {
    return employees.find((employee) => employee.id === Number(value))?.fullName || t('notAvailable');
  }
  if (name === 'module' || name === 'modules') {
    const modules = (Array.isArray(value) ? value : [value]).filter((module) => (
      typeof module === 'string' && (ACADEMY_ACCESS_MODULES as readonly string[]).includes(module)
    ));
    return modules.map((module) => formatUserModule(module, t)).join(', ') || '—';
  }
  if (name.endsWith('at') || name.endsWith('date')) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
      ? formatAcademyDate(value, language, { dateStyle: 'short', ...(name.endsWith('at') ? { timeStyle: 'short' as const } : {}) })
      : '—';
  }
  if (name === 'archivereason') {
    const reason = LEAD_ARCHIVE_REASONS.find((item) => item.code === value);
    return reason ? t(reason.translationKey) : t('archiveReasonOther');
  }
  if (name === 'status' || name === 'learningstatus') {
    if (entity.includes('lead')) {
      const status = LEAD_STATUSES.find((item) => item.code === value);
      return status ? t(status.translationKey) : t('statusNotSpecified');
    }
    const studentStatusKeys: Record<string, TranslationKey> = {
      studying: 'studentStatusStudying', paused: 'studentStatusPaused',
      completed: 'studentStatusCompleted', expelled: 'studentStatusExpelled', trial: 'studentStatusTrial',
    };
    const paymentStatusKeys: Record<string, TranslationKey> = {
      paid: 'paymentStatusPaid', pending: 'paymentStatusPending', refunded: 'paymentStatusRefunded',
      overdue: 'paymentStatusOverdue', planned: 'financeCenterPlanned', cancelled: 'financeCenterCancelled',
    };
    const key = entity.includes('student') || name === 'learningstatus'
      ? studentStatusKeys[String(value)]
      : entity.includes('group') ? groupStatusLabelKey(String(value))
        : entity.includes('lesson') ? lessonStatusLabelKey(String(value))
          : paymentStatusKeys[String(value)];
    return key ? t(key) : t('statusNotSpecified');
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
};
