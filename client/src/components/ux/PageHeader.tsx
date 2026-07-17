import { Fragment } from 'react';
import { Link } from 'wouter';
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

  const items = breadcrumbs.length > 0
    ? breadcrumbs
    : [{ label: t('dashboard'), href: '/' }, { label: title }];

  return (
    <div data-page-header className="mb-6 flex min-w-0 shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
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
        <h1 className="break-words text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex w-full max-w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
