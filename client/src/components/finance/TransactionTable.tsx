import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import type { financeCopy } from '@/lib/financeCenter';
import type { Row } from '@/lib/financeRows';
import { StatusBadge } from '@/components/finance/StatusBadge';

export function TransactionTable({
  rows,
  copy,
  money,
  dateTime,
  categoryLabel,
  compact = false,
  pageSize = 25,
}: {
  rows: Row[];
  copy: ReturnType<typeof financeCopy>;
  money: (value: number) => string;
  dateTime: (value: unknown) => string;
  categoryLabel: (value: string) => string;
  compact?: boolean;
  pageSize?: number;
}) {
  const columns: DataTableColumn<Row>[] = [
    {
      key: 'occurredAt',
      header: copy.date,
      accessor: (row) => new Date(String(row.occurredAt || 0)).getTime() || 0,
      render: (row) => dateTime(row.occurredAt),
      sortable: true,
      cellClassName: 'whitespace-nowrap text-muted-foreground',
    },
    {
      key: 'title',
      header: copy.operation,
      accessor: (row) => row.title || '',
      render: (row) => (
        <span className="block max-w-[280px] truncate font-medium" title={row.title || undefined}>
          {row.title || '—'}
        </span>
      ),
      sortable: true,
      mobilePrimary: true,
    },
    {
      key: 'category',
      header: copy.category,
      accessor: (row) => categoryLabel(row.category || row.kind),
      sortable: true,
    },
    ...(compact ? [] : [{
      key: 'counterparty',
      header: copy.counterparty,
      accessor: (row: Row) => row.counterparty || '',
      render: (row: Row) => (
        <span className="block max-w-[240px] truncate text-muted-foreground" title={row.counterparty || undefined}>
          {row.counterparty || '—'}
        </span>
      ),
      sortable: true,
    }]),
    {
      key: 'status',
      header: copy.status,
      accessor: (row) => row.status || '',
      render: (row) => <StatusBadge status={row.status} copy={copy} />,
      sortable: true,
    },
    {
      key: 'amountUzs',
      header: copy.amount,
      accessor: (row) => Number(row.amountUzs || 0),
      render: (row) => (
        <span className={row.direction === 'in' ? 'text-emerald-700' : 'text-destructive'}>
          {row.direction === 'in' ? '+' : '−'}{money(row.amountUzs)}
        </span>
      ),
      sortable: true,
      cellClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
    },
  ];

  return (
    <DataTable
      className="overflow-auto overscroll-contain max-h-[min(70dvh,48rem)] [scrollbar-gutter:stable]"
      columns={columns}
      data={rows}
      keyExtractor={(row) => String(row.id)}
      pageSize={pageSize}
      emptyState={<div className="py-12 text-center text-sm text-muted-foreground">{copy.noData}</div>}
    />
  );
}
