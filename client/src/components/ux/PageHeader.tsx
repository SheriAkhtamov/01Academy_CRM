import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useTranslation } from '@/hooks/useTranslation';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumbs = [], actions }: PageHeaderProps) {
  const { t } = useTranslation();
  const [location] = useLocation();

  const items = breadcrumbs.length > 0
    ? breadcrumbs
    : [{ label: t('dashboard'), href: '/' }, { label: title }];

  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            {items.map((item, index) => (
              <Fragment key={`${item.label}-${index}`}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {item.href && index < items.length - 1 ? (
                    <BreadcrumbLink asChild>
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function useBreadcrumbTitle(fallback: string) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const map: Record<string, string> = {
    '/': t('navDashboard'),
    '/leads': t('navLeads'),
    '/pipeline': t('salesPipeline'),
    '/students': t('students'),
    '/courses': t('navCourses'),
    '/groups': t('navGroups'),
    '/lessons': t('navLessons'),
    '/attendance': t('attendanceLabel'),
    '/payments': t('navPayments'),
    '/finance': t('navFinance'),
    '/analytics': t('navAnalytics'),
    '/risks': t('navRisks'),
    '/warm-base': t('warmBase'),
    '/referrals': t('navReferrals'),
    '/integrations': t('navIntegrations'),
    '/settings': t('settings'),
    '/admin': t('administration'),
    '/employees': t('employees'),
  };
  return map[location] || fallback;
}
