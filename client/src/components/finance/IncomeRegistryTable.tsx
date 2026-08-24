import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import type { financeCopy } from '@/lib/financeCenter';
import type { Row } from '@/lib/financeRows';
import { StatusBadge } from '@/components/finance/StatusBadge';

export function IncomeRegistryTable({
  rows,
  copy,
  money,
  dateTime,
  methodLabel,
}: {
  rows: Row[];
  copy: ReturnType<typeof financeCopy>;
  money: (value: number) => string;
  dateTime: (value: unknown) => string;
  methodLabel: (value: string) => string;
}) {
  const columns: DataTableColumn<Row>[] = [
    {
      key: 'paidAt',
      header: copy.date,
      accessor: (row: Row) => new Date(String(row.paidAt || row.createdAt || 0)).getTime() || 0,
      render: (row: Row) => dateTime(row.paidAt || row.createdAt),
      sortable: true,
      cellClassName: 'whitespace-nowrap text-muted-foreground',
    },
    {
      key: 'customerName',
      header: copy.customer,
      accessor: (row: Row) => row.customerName || '',
      render: (row: Row) => <span className="block max-w-[280px] truncate font-medium" title={row.customerName || undefined}>{row.customerName || '—'}</span>,
      sortable: true,
      mobilePrimary: true,
    },
    { key: 'courseName', header: copy.course, accessor: (row: Row) => row.courseName || '', render: (row: Row) => row.courseName || '—', sortable: true },
    { key: 'managerName', header: copy.manager, accessor: (row: Row) => row.managerName || '', render: (row: Row) => row.managerName || '—', sortable: true },
    { key: 'method', header: copy.method, accessor: (row: Row) => methodLabel(row.method), sortable: true },
    {
      key: 'status',
      header: copy.status,
      accessor: (row: Row) => row.status || '',
      render: (row: Row) => <StatusBadge status={row.status} copy={copy} />,
      sortable: true,
    },
    {
      key: 'amountUzs',
      header: copy.amount,
      accessor: (row: Row) => Number(row.amountUzs || 0),
      render: (row: Row) => (
        <span className={row.status === 'paid' ? 'text-emerald-700' : undefined}>{money(row.amountUzs)}</span>
      ),
      sortable: true,
      cellClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      keyExtractor={(row) => String(row.id)}
      emptyState={<div className="py-12 text-center text-sm text-muted-foreground">{copy.noData}</div>}
    />
  );
}
