import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/hooks/useTranslation';
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

  // Reset to the first page only when sorting, page size, or the visible row set
  // changes (filtering). Background refetches keep the array contents but change its
  // identity, so depending on `data` itself would kick the user back to page 1
  // after every mutation; out-of-range pages are clamped below instead.
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length, sortKey, sortDirection, pageSize]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);
  const pagedData = pageSize > 0 ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sortedData;

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

  return (
    <div className={cn(rootClassName)} aria-busy={isLoading}>
      <div className={cn('overflow-x-auto', className)}>
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-muted/70">
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
                    rowClassName?.(row)
                  )}
                  onClick={() => onRowClick?.(row)}
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
                      {column.render
                        ? column.render(row, index)
                        : column.accessor
                          ? column.accessor(row)
                          : row[column.key]}
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
      </div>
      {!isLoading ? (
        <PaginationControls
          page={currentPage}
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
