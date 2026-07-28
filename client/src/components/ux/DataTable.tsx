import { useMemo, useState, useEffect } from 'react';
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
import { useTranslation } from '@/hooks/useTranslation';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { Skeleton } from '@/components/ui/skeleton';

type SortDirection = 'asc' | 'desc' | null;

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
  defaultSortKey,
  defaultSortDirection = 'asc',
  onRowClick,
  rowClassName,
  pageSize: initialPageSize = 25,
  isLoading = false,
}: DataTableProps<T>) {
  const { t } = useTranslation();
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

  useEffect(() => {
    setCurrentPage(1);
  }, [data, sortKey, sortDirection, pageSize]);

  const totalPages = pageSize > 0 ? Math.ceil(sortedData.length / pageSize) : 1;
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
    <div>
      <div className={cn('overflow-x-auto', className)}>
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-muted/70">
            <TableRow className="border-b border-border/70 hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  tabIndex={column.sortable ? 0 : undefined}
                  role={column.sortable ? 'button' : undefined}
                  aria-label={column.sortable ? `Sort by ${column.key}` : undefined}
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
            {pagedData.length > 0 ? (
              pagedData.map((row, index) => (
                <TableRow
                  key={keyExtractor(row, index)}
                  className={cn(
                    'border-b border-border/50 transition-colors hover:bg-accent/40',
                    onRowClick && 'cursor-pointer',
                    rowClassName?.(row)
                  )}
                  onClick={() => onRowClick?.(row)}
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
                </TableRow>
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
      {sortedData.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 px-1 text-xs text-muted-foreground border-t border-border/40 pt-3">
          <div className="flex items-center gap-2">
            <span>
              {Math.min((currentPage - 1) * pageSize + 1, sortedData.length)}-
              {Math.min(currentPage * pageSize, sortedData.length)} {t('ofLabel')} {sortedData.length}
            </span>
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-muted-foreground/70">{t('perPage')}</span>
              <Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
                <SelectTrigger className="h-7 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <span className="mr-2 text-muted-foreground/80">
                {t('page')} {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { DataTableColumn };
