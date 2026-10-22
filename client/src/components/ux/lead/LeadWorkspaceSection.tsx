import { useId, type ReactNode, type Ref } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LeadWorkspaceSectionId = 'contacts' | 'students' | 'details' | 'preferences';

interface LeadWorkspaceSectionProps {
  section: LeadWorkspaceSectionId;
  title: string;
  summary: string;
  icon: LucideIcon;
  count?: number;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  cardRef?: Ref<HTMLDetailsElement>;
  contentClassName?: string;
  children: ReactNode;
}

/** Keep disclosure navigation outside the disabled form controls.
 * Mounted fields retain drafts and registration while the section is closed.
 */
export function LeadWorkspaceSection({
  section, title, summary, icon: Icon, count, open, disabled, onOpenChange,
  cardRef, contentClassName, children,
}: LeadWorkspaceSectionProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  const contentId = `${id}-content`;

  return (
    <details
      ref={cardRef}
      open={open}
      tabIndex={-1}
      data-lead-section={section}
      className="lead-workspace-disclosure scroll-mt-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <summary
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={contentId}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        data-topographic="card"
        className="lead-workspace-disclosure-trigger"
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (!event.repeat) onOpenChange(!open);
        }}
      >
        <span className="lead-workspace-disclosure-icon" aria-hidden="true"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span id={titleId} className="text-sm font-semibold leading-5">{title}</span>
            {count !== undefined ? <span className="lead-workspace-disclosure-count">{count}</span> : null}
          </span>
          <span id={summaryId} className={cn('text-xs text-muted-foreground', open ? 'sr-only' : 'block truncate leading-5')}>
            {summary}
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      </summary>
      <fieldset id={contentId} hidden={!open} disabled={disabled} aria-labelledby={titleId} className={cn('lead-workspace-disclosure-content min-w-0', contentClassName)}>
        {children}
      </fieldset>
    </details>
  );
}
