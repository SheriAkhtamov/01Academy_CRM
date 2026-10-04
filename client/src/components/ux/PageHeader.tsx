import { motion } from 'framer-motion';
import { fadeInUp, staggerContainer } from '@/lib/motion';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  titleAccessory?: React.ReactNode;
  titleActions?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  titleAccessory,
  titleActions,
  actions,
}: PageHeaderProps) {
  return (
    // Every module page opens with the same title and action layout.
    <motion.div
      data-page-header
      className="mb-6 flex min-w-0 shrink-0 flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between"
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="visible"
    >
      <div className={`min-w-0 space-y-1${titleActions ? ' w-full' : ''}`}>
        <motion.div variants={fadeInUp} className="flex flex-wrap items-center gap-2">
          <h1 className="break-words text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {titleAccessory}
          {titleActions && <div className="ml-auto shrink-0">{titleActions}</div>}
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
          className="flex w-full max-w-full flex-wrap items-center gap-2 2xl:w-auto 2xl:shrink-0 2xl:justify-end"
        >
          {actions}
        </motion.div>
      )}
    </motion.div>
  );
}
