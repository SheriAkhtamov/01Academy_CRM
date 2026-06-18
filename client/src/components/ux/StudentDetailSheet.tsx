import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  CreditCard,
  FolderOpen,
  History,
  MessageSquare,
  Phone,
  Star,
  User,
  Users,
} from 'lucide-react';

interface StudentDetailSheetProps {
  student: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordPayment?: (leadId: number) => void;
  data?: {
    projects?: any[];
    payments?: any[];
    referrals?: any[];
  };
  dateTime: (value: string | null | undefined) => string;
}

export function StudentDetailSheet({
  student,
  open,
  onOpenChange,
  onRecordPayment,
  data,
  dateTime,
}: StudentDetailSheetProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('info');

  useEffect(() => {
    if (open) setActiveTab('info');
  }, [open, student?.id]);

  if (!student) return null;

  const projects = data?.projects?.filter((project: any) => project.studentId === student.id) ?? [];
  const payments = data?.payments?.filter((payment: any) => payment.studentId === student.id) ?? [];
  const referrals = data?.referrals?.filter((reward: any) => reward.referrerStudentId === student.id) ?? [];
  const displayName = student.studentName || student.contactName;
  const studentStatusLabel = (status: string) => {
    if (status === 'studying') return t('studentStatusStudying');
    if (status === 'paused') return t('studentStatusPaused');
    if (status === 'completed') return t('studentStatusCompleted');
    if (status === 'expelled') return t('studentStatusExpelled');
    return status;
  };
  const riskFlagLabel = (flag: string) => {
    if (flag === 'attendance_below_70') return t('riskAttendanceBelow70');
    if (flag === 'churn_risk') return t('riskChurn');
    if (flag === 'low_satisfaction') return t('riskLowSatisfaction');
    return flag;
  };

  const tabs = [
    { value: 'info', label: t('generalTab'), icon: User },
    { value: 'schedule', label: t('group'), icon: Calendar },
    { value: 'attendance', label: t('attendanceTab'), icon: CheckCircle2 },
    { value: 'progress', label: t('progressLabel'), icon: BookOpen },
    { value: 'portfolio', label: t('portfolioTab'), icon: FolderOpen },
    { value: 'payments', label: t('navPayments'), icon: CreditCard },
    { value: 'nps', label: t('npsTab'), icon: Star },
    { value: 'referrals', label: t('navReferrals'), icon: Users },
    { value: 'history', label: t('historyTab'), icon: History },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 border-2 border-slate-100">
              <AvatarFallback className="bg-gradient-to-br from-primary-500 to-primary-700 text-white text-lg">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl truncate">{displayName}</SheetTitle>
              <SheetDescription className="mt-1">
                {student.contactName} • {student.phone}
              </SheetDescription>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${String(student.phone || '').replace(/[^\d+]/g, '')}`}>
                    <Phone data-icon="inline-start" />
                    {t('call')}
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={student.messenger?.startsWith('@')
                      ? `https://t.me/${student.messenger.slice(1)}`
                      : `https://wa.me/${String(student.phone || '').replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageSquare data-icon="inline-start" />
                    {t('write')}
                  </a>
                </Button>
                {student.leadId && onRecordPayment ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      onRecordPayment(Number(student.leadId));
                    }}
                  >
                    <CreditCard data-icon="inline-start" />
                    {t('recordAnotherPayment')}
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">
                  {studentStatusLabel(student.status)}
                </Badge>
                {student.groupName && <Badge variant="outline">{student.groupName}</Badge>}
                {student.courseName && <Badge variant="outline">{student.courseName}</Badge>}
                {Array.isArray(student.riskFlags) &&
                  student.riskFlags.map((flag: string) => (
                    <Badge key={flag} variant="destructive">
                      {riskFlagLabel(flag)}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t('attendanceLabel')}</span>
                <span className="font-medium text-slate-700">{student.attendancePercent}%</span>
              </div>
              <Progress value={student.attendancePercent} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t('progressLabel')}</span>
                <span className="font-medium text-slate-700">{student.progressPercent}%</span>
              </div>
              <Progress value={student.progressPercent} />
            </div>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid grid-cols-3 h-auto mb-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="text-xs py-2 flex flex-col items-center gap-1">
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="info" className="space-y-3">
            <InfoRow label={t('ageLabel')} value={String(student.studentAge ?? student.age ?? t('noData'))} />
            <InfoRow label={t('managerLabel')} value={student.managerName || t('noData')} />
            <InfoRow label={t('referralCodeLabel')} value={student.referralCode || t('noData')} />
            <InfoRow label={t('nextPaymentLabel')} value={dateTime(student.nextPaymentAt)} />
          </TabsContent>

          <TabsContent value="schedule" className="space-y-3">
            <InfoRow label={t('courseLabel')} value={student.courseName || t('noCourse')} />
            <InfoRow label={t('groupLabel')} value={student.groupName || t('noGroup')} />
          </TabsContent>

          <TabsContent value="attendance">
            <div className="text-sm text-slate-600">
              {t('attendanceRateLabel')} {student.attendancePercent}%
            </div>
          </TabsContent>

          <TabsContent value="progress">
            <div className="text-sm text-slate-600">
              {t('courseProgressLabel')} {student.progressPercent}%
            </div>
          </TabsContent>

          <TabsContent value="portfolio" className="space-y-2">
            {projects.length > 0 ? (
              projects.map((project: any) => (
                <div key={project.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="font-medium">{project.title || project.name}</div>
                  {project.description && <div className="text-slate-500 text-xs mt-1">{project.description}</div>}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{t('noProjects')}</p>
            )}
          </TabsContent>

          <TabsContent value="payments" className="space-y-2">
            {payments.length > 0 ? (
              payments.map((payment: any) => (
                <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {Number(payment.amountUzs || 0).toLocaleString('ru-RU')} {t('uzs')}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{payment.period || payment.method || t('payment')}</div>
                  </div>
                  <div className="text-right">
                    <Badge variant={payment.status === 'paid' ? 'success' : payment.status === 'overdue' ? 'destructive' : 'warning'}>
                      {payment.status === 'paid' ? t('paymentStatusPaid') : payment.status === 'overdue' ? t('paymentStatusOverdue') : t('paymentStatusPending')}
                    </Badge>
                    <div className="mt-1 text-xs text-slate-500">{dateTime(payment.paidAt || payment.createdAt)}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">{t('noPayments')}</p>
            )}
          </TabsContent>

          <TabsContent value="nps" className="space-y-3">
            <InfoRow label={t('averageRatingLabel')} value={student.satisfactionAvg || t('noData')} />
            <InfoRow label={t('parentLabel')} value={student.parentFeedback || t('noData')} />
          </TabsContent>

          <TabsContent value="referrals" className="space-y-2">
            <InfoRow label={t('referralCodeField')} value={student.referralCode || t('noData')} />
            <InfoRow label={t('awardsField')} value={referrals.length.toString()} />
            {referrals.length > 0 && (
              <div className="mt-3 space-y-2">
                {referrals.map((reward: any) => (
                  <div key={reward.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    {t('referralBonus')} {reward.rewardValue || reward.amountUzs || t('noData')}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-medium">{t('clientCreated')}</div>
                <div className="mt-1 text-xs text-slate-500">{dateTime(student.createdAt)}</div>
              </div>
              {payments.map((payment: any) => (
                <div key={`history-payment-${payment.id}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="font-medium">{t('paymentSaved')}</div>
                  <div className="mt-1 text-xs text-slate-500">{dateTime(payment.paidAt || payment.createdAt)}</div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}
