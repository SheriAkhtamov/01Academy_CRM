import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface PaginationControlsProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  disabled?: boolean;
  className?: string;
}

export function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  disabled = false,
  className,
}: PaginationControlsProps) {
  const { t } = useTranslation();
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);
  const rangeLabel = t('paginationRange')
    .replace('{from}', String(firstItem))
    .replace('{to}', String(lastItem))
    .replace('{total}', String(totalItems));

  return (
    <nav
      aria-label={t('paginationNavigation')}
      /*
        Every control lives on the left, and the bottom-right corner is left
        empty on purpose. Paginated tables fill the page, so this bar always
        sits against the bottom edge — exactly where the draggable telephony
        widget rests by default (fixed, z-70, pointer-events-auto). It covered
        the page counter and both arrows, so a 26-page archive could not be
        paged past the first screen. Reserving the corner fixes that for every
        table at once, without hard-coding the widget's size or position.
      */
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/70 bg-muted/10 px-4 py-3 text-xs text-muted-foreground',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium tabular-nums text-foreground/80">{rangeLabel}</span>
        <div className="flex items-center gap-1.5">
          <span>{t('perPage')}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[72px] bg-background text-xs tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 tabular-nums text-foreground/70">
          {t('page')} {currentPage} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-background"
          aria-label={t('previousPage')}
          disabled={disabled || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-background"
          aria-label={t('nextPage')}
          disabled={disabled || currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
