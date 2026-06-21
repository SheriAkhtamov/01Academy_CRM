import { useMemo, useState } from 'react';
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
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey || null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortDirection);

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
    if (sortKey !== key) return <ArrowUpDown className="ml-1.5 h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-50 transition-opacity" />;
    if (sortDirection === 'asc') return <ArrowUp className="ml-1.5 h-3 w-3 text-primary-600" />;
    return <ArrowDown className="ml-1.5 h-3 w-3 text-primary-600" />;
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/70">
          <TableRow className="border-b border-border/70 hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  'whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                  column.sortable && 'cursor-pointer select-none group',
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
          {sortedData.length > 0 ? (
            sortedData.map((row, index) => (
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
                  <div className="py-12 text-center text-sm text-slate-500">{t('noData')}</div>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export type { DataTableColumn };
