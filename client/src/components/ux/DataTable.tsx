import { Fragment, useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useIsMobileViewport } from '@/hooks/useMediaQuery';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { useMotionFeature } from '@/components/ux/motion';
import { DURATION, EASE } from '@/lib/motion';

type SortDirection = 'asc' | 'desc' | null;

/**
 * `TableRow` forwards its ref and merges className, so framer can drive it
 * directly — that keeps the row's styling in one place instead of duplicating
 * the class list onto a bare `motion.tr`.
 */
const MotionTableRow = motion.create(TableRow);

const MotionListItem = motion.li;

/**
 * Rows cascade in, but the cascade is capped: past ~10 rows the delay stops
 * growing, so a 100-row page still finishes in a third of a second instead of
 * trickling down the screen for three.
 */
const rowDelay = (index: number) => Math.min(index * 0.025, 0.25);

interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  accessor?: (row: T) => any;
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  cellClassName?: string;
  /**
   * On a phone this column becomes the card's headline and loses its label —
   * the name of the thing does not need to be told it is a name. Falls back to
   * the first visible column when no column claims it.
   */
  mobilePrimary?: boolean;
  /**
   * Dropped from the phone card. For columns that only exist because a wide
   * grid had room: row-hover action buttons, redundant ids, a second date that
   * repeats the first.
   */
  mobileHidden?: boolean;
  /**
   * The label to print on the phone card when `header` is an icon, a checkbox
   * or anything else that only reads as a heading in a table.
   */
  mobileLabel?: React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  emptyState?: React.ReactNode;
  className?: string;
  rootClassName?: string;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  pageSize?: number;
  isLoading?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyExtractor,
  emptyState,
  className,
  rootClassName,
  defaultSortKey,
  defaultSortDirection = 'asc',
  onRowClick,
  rowClassName,
  pageSize: initialPageSize = 25,
  isLoading = false,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const animateRows = useMotionFeature('entrances');
  /*
    A phone cannot show eight columns. The old answer was a horizontal
    scroller, which meant the reader had to drag every row sideways to read it
    and lost the header the moment they did. Below `md` each row becomes a
    card instead: headline on top, the rest as labelled pairs. This is a
    different tree, not different paint, which is why it is a media *query*
    and not a `md:` class — and why jsdom, where matchMedia is absent, keeps
    getting the table the DOM tests are written against.
  */
  const isMobile = useIsMobileViewport();
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey || null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortDirection);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data;
    const column = columns.find((col) => col.key === sortKey);
    if (!column) return data;

    return [...data].sort((a, b) => {
      let valueA: any;
      let valueB: any;

      if (column.accessor) {
        valueA = column.accessor(a);
        valueB = column.accessor(b);
      } else {
        valueA = a[sortKey];
        valueB = b[sortKey];
      }

      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return sortDirection === 'asc' ? -1 : 1;
      if (valueB == null) return sortDirection === 'asc' ? 1 : -1;

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
      }

      const strA = String(valueA).toLowerCase();
      const strB = String(valueB).toLowerCase();
      if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
      if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDirection, columns]);

  // Reset to the first page only when sorting or page size changes. A row
  // arriving from a background refetch must not kick a user browsing page 4
  // back to page 1: out-of-range pages are clamped below instead, and the
  // clamp is applied during render so shrinking result sets never paint an
  // empty body frame.
  useEffect(() => {
    setCurrentPage(1);
  }, [sortKey, sortDirection, pageSize]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);
  const pagedData = pageSize > 0 ? sortedData.slice((safePage - 1) * pageSize, safePage * pageSize) : sortedData;

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'));
      if (sortDirection === 'desc') {
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (key: string, sortable?: boolean) => {
    if (!sortable) return null;
    if (sortKey !== key) return <ArrowUpDown className="ml-1.5 h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity" />;
    if (sortDirection === 'asc') return <ArrowUp className="ml-1.5 h-3 w-3 text-primary font-bold" />;
    return <ArrowDown className="ml-1.5 h-3 w-3 text-primary font-bold" />;
  };

  /**
   * `cellClassName` is written for a table cell, where a fixed width sizes the
   * whole column. On a card the same class sizes one value inside a list, so
   * `w-12` on a checkbox column would crush it — the fixed widths are dropped
   * and everything else, typography included, carries over.
   */
  const cardCellClassName = (cellClassName?: string) => cellClassName
    ?.split(/\s+/)
    .filter((token) => !/^w-(?!full\b)/.test(token))
    .join(' ');

  const renderCell = (column: DataTableColumn<T>, row: T, index: number) => (
    column.render
      ? column.render(row, index)
      : column.accessor
        ? column.accessor(row)
        : row[column.key]
  );

  // Card columns, resolved once: everything the phone still shows, split into
  // the headline and the labelled remainder.
  const mobileColumns = useMemo(() => {
    const visible = columns.filter((column) => !column.mobileHidden);
    const primary = visible.find((column) => column.mobilePrimary) ?? visible[0];
    return {
      primary,
      secondary: visible.filter((column) => column !== primary),
      sortable: columns.filter((column) => column.sortable),
    };
  }, [columns]);

  const sortableLabel = (column: DataTableColumn<T>) => {
    const label = column.mobileLabel ?? column.header;
    return typeof label === 'string' ? label : column.key;
  };

  const renderSortBar = () => {
    // Nothing to order, or nothing to order by.
    if (mobileColumns.sortable.length === 0) return null;
    if (!isLoading && sortedData.length === 0) return null;
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('sortRows')}
        </span>
        <Select
          value={sortKey ?? 'none'}
          onValueChange={(value) => {
            if (value === 'none') {
              setSortKey(null);
              setSortDirection(null);
              return;
            }
            setSortKey(value);
            setSortDirection((prev) => prev ?? 'asc');
          }}
        >
          <SelectTrigger className="h-9 min-w-0 flex-1 bg-background text-xs" aria-label={t('sortRows')}>
            <SelectValue placeholder={t('sortUnsorted')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('sortUnsorted')}</SelectItem>
            {mobileColumns.sortable.map((column) => (
              <SelectItem key={column.key} value={column.key}>
                {sortableLabel(column)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 bg-background"
          aria-label={t('toggleSortDirection')}
          title={sortDirection === 'desc' ? t('sortDescending') : t('sortAscending')}
          disabled={!sortKey}
          onClick={() => setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
        >
          {sortDirection === 'desc' ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
    );
  };

  const renderCards = () => {
    if (isLoading) {
      return (
        <div className="divide-y divide-border/50">
          {Array.from({ length: Math.min(pageSize > 0 ? pageSize : 5, 5) }, (_, cardIndex) => (
            <div key={`skeleton-card-${cardIndex}`} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      );
    }

    if (pagedData.length === 0) {
      return emptyState || (
        <div className="py-12 text-center text-sm text-muted-foreground">{t('noData')}</div>
      );
    }

    return (
      <ul className="divide-y divide-border/50">
        {pagedData.map((row, index) => {
          const rowKey = keyExtractor(row, index);
          return (
            <MotionListItem
              key={rowKey}
              className={cn(
                'px-4 py-3 transition-colors',
                onRowClick && 'cursor-pointer active:bg-accent/50',
                onRowClick && 'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                rowClassName?.(row),
              )}
              /*
                The whole card is the target — 44px of finger needs more than a
                link-sized word to land on. It stays a plain listitem with a
                click handler rather than a <button>, because the cells it wraps
                already contain their own buttons and menus, and a button may
                not nest inside a button.
              */
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
              onKeyDown={onRowClick ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onRowClick(row);
                }
              } : undefined}
              initial={animateRows ? { opacity: 0, y: 6 } : false}
              animate={animateRows ? { opacity: 1, y: 0 } : undefined}
              transition={animateRows ? {
                duration: DURATION.base,
                ease: EASE.out,
                delay: rowDelay(index),
              } : undefined}
            >
              {mobileColumns.primary ? (
                <div className={cn('text-sm font-semibold text-foreground', cardCellClassName(mobileColumns.primary.cellClassName))}>
                  {renderCell(mobileColumns.primary, row, index)}
                </div>
              ) : null}
              {mobileColumns.secondary.length > 0 ? (
                <dl className="mt-2 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
                  {mobileColumns.secondary.map((column) => {
                    const label = column.mobileLabel ?? column.header;
                    // A column with no heading — an actions cell, a checkbox —
                    // has nothing to label, so its content takes the full width
                    // instead of leaving an empty term beside it.
                    const hasLabel = typeof label === 'string' ? label.trim().length > 0 : Boolean(label);
                    return (
                      <Fragment key={`${rowKey}-${column.key}`}>
                        {hasLabel ? (
                          <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {label}
                          </dt>
                        ) : null}
                        <dd className={cn('min-w-0 text-sm text-foreground', hasLabel ? '' : 'col-span-2', cardCellClassName(column.cellClassName))}>
                          {renderCell(column, row, index)}
                        </dd>
                      </Fragment>
                    );
                  })}
                </dl>
              ) : null}
            </MotionListItem>
          );
        })}
      </ul>
    );
  };

  return (
    <div className={cn(rootClassName)} aria-busy={isLoading}>
      {isMobile ? renderSortBar() : null}
      {/*
        The pane keeps its height and its own scroll on a phone as well. Letting
        the cards run to their natural length reads better in isolation, but
        every caller wraps this in a `h-full … overflow-hidden` card sized for
        the app shell: with nothing here to scroll, the list simply grew past
        that card and was clipped, unreachable, at row three. The pane is the
        scroller the surrounding layout is built around.
      */}
      <div className={cn('overflow-x-auto', className)}>
        {isMobile ? renderCards() : (
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm">
            <TableRow className="border-b border-border/70 hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  tabIndex={column.sortable ? 0 : undefined}
                  role={column.sortable ? 'button' : undefined}
                  aria-label={column.sortable
                    ? t('sortByColumn').replace(
                        '{column}',
                        typeof column.header === 'string' ? column.header : column.key,
                      )
                    : undefined}
                  onKeyDown={(e) => {
                    if (column.sortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleSort(column.key, column.sortable);
                    }
                  }}
                  className={cn(
                    'whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm',
                    column.sortable && 'cursor-pointer select-none group hover:text-foreground transition-colors',
                    column.className
                  )}
                  onClick={() => handleSort(column.key, column.sortable)}
                >
                  <div className="flex items-center">
                    {column.header}
                    {getSortIcon(column.key, column.sortable)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: Math.min(pageSize > 0 ? pageSize : 6, 6) }, (_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className="border-b border-border/50">
                  {columns.map((column) => (
                    <TableCell key={`skeleton-${rowIndex}-${column.key}`} className="p-3 px-4">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pagedData.length > 0 ? (
              /*
                Rows animate in, never out. A <tr> fading to opacity 0 keeps its
                full height for as long as it is mounted, so an exit animation
                leaves a stack of blank rows below the results — measured on the
                lead archive, a search narrowing 655 leads to 20 left 25 ghost
                rows holding 61px each, and they never came back out. Height is
                not animatable on a table row either, so there is no version of
                this that leaves gracefully: the row simply goes.
              */
              pagedData.map((row, index) => (
                <MotionTableRow
                  key={keyExtractor(row, index)}
                  className={cn(
                    'border-b border-border/50 transition-colors hover:bg-accent/40',
                    onRowClick && 'cursor-pointer',
                    onRowClick && 'focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary',
                    rowClassName?.(row)
                  )}
                  onClick={() => onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  } : undefined}
                  initial={animateRows ? { opacity: 0, y: 6 } : false}
                  animate={animateRows ? { opacity: 1, y: 0 } : undefined}
                  transition={animateRows ? {
                    duration: DURATION.base,
                    ease: EASE.out,
                    delay: rowDelay(index),
                  } : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={`${keyExtractor(row, index)}-${column.key}`} className={cn('p-3 px-4', column.cellClassName)}>
                      {renderCell(column, row, index)}
                    </TableCell>
                  ))}
                </MotionTableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {emptyState || (
                    <div className="py-12 text-center text-sm text-muted-foreground">{t('noData')}</div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        )}
      </div>
      {!isLoading ? (
        <PaginationControls
          page={safePage}
          pageSize={pageSize}
          totalItems={sortedData.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setCurrentPage(1);
          }}
        />
      ) : null}
    </div>
  );
}

export type { DataTableColumn };
