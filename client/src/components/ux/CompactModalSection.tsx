import { forwardRef, useId, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import './compact-modal.css';

export type CompactModalTone = 'sky' | 'teal' | 'violet' | 'amber';

interface CompactModalSectionProps {
  title: string;
  summary?: ReactNode;
  icon?: LucideIcon;
  tone?: CompactModalTone;
  count?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  collapsible?: boolean;
  disabled?: boolean;
  actions?: ReactNode;
  contentClassName?: string;
  className?: string;
  sectionId?: string;
  children: ReactNode;
}

/** Keep fields mounted so folding a section never discards its draft.
 * Disable only the content: headings remain available for read-only navigation.
 * Forms that reveal invalid fields should control `open` before focusing a field.
 */
export const CompactModalSection = forwardRef<HTMLElement, CompactModalSectionProps>(function CompactModalSection({
  title, summary, icon: Icon, tone = 'sky', count,
  open, onOpenChange, defaultOpen = false, collapsible = true, disabled,
  actions, contentClassName, className, sectionId, children,
}, ref) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const expanded = !collapsible || (open ?? localOpen);
  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  const contentId = `${id}-content`;
  const hasSummary = summary !== undefined && summary !== null && summary !== '';
  const heading = (
    <>
      {Icon ? <span className="compact-section-icon" aria-hidden="true"><Icon className="size-4" /></span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span id={titleId} className="text-sm font-semibold leading-5">{title}</span>
          {count !== undefined ? <span className="compact-section-count">{count}</span> : null}
        </span>
        {hasSummary ? (
          <span id={summaryId} className={cn('text-xs text-muted-foreground', collapsible && expanded ? 'sr-only' : 'block truncate leading-5')}>
            {summary}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-modal-section={sectionId}
      data-tone={tone}
      data-expanded={expanded}
      className={cn('compact-section scroll-mt-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <div data-topographic="card" className="compact-section-header">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-labelledby={titleId}
            aria-describedby={hasSummary ? summaryId : undefined}
            className="compact-section-trigger"
            onClick={() => {
              if (open === undefined) setLocalOpen(!expanded);
              onOpenChange?.(!expanded);
            }}
          >
            {heading}
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
          </button>
        ) : <div className="compact-section-heading">{heading}</div>}
        {actions ? <div className="compact-section-actions">{actions}</div> : null}
      </div>
      <fieldset
        id={contentId}
        hidden={!expanded}
        disabled={disabled}
        aria-labelledby={titleId}
        className={cn('compact-section-content min-w-0', contentClassName)}
      >
        {children}
      </fieldset>
    </section>
  );
});
