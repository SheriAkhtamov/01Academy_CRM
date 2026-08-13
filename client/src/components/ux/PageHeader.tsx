import { Fragment } from 'react';
import { motion } from 'framer-motion';
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
import { fadeInDown, fadeInUp, staggerContainer } from '@/lib/motion';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  titleAccessory?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs = [],
  titleAccessory,
  actions,
}: PageHeaderProps) {
  const { t } = useTranslation();

  const items = breadcrumbs.length > 0
    ? breadcrumbs
    : [{ label: t('dashboard'), href: '/' }, { label: title }];

  return (
    // Every module page opens with this header, so it sets the rhythm for the
    // screen: breadcrumb, then title, then the action buttons — each a beat
    // apart, finishing well before the page body has finished fetching.
    <motion.div
      data-page-header
      className="mb-6 flex min-w-0 shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between"
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="visible"
    >
      <div className="min-w-0 space-y-1">
        <motion.div variants={fadeInDown}>
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
        </motion.div>
        <motion.div variants={fadeInUp} className="flex flex-wrap items-center gap-2">
          <h1 className="break-words text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {titleAccessory}
        </motion.div>
        {subtitle && (
          <motion.p variants={fadeInUp} className="max-w-3xl text-sm text-muted-foreground">
            {subtitle}
          </motion.p>
        )}
      </div>
      {actions && (
        <motion.div
          variants={fadeInUp}
          className="flex w-full max-w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end"
        >
          {actions}
        </motion.div>
      )}
    </motion.div>
  );
}
