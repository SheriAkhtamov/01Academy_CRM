export type Row = Record<string, any>;

export type ExpenseRegistryRow = Row & { entryKind: 'operating' | 'marketing' };

export const payrollEntryKey = (row: Row) => String(row.employeeKey ?? (
  row.employeeUserId ? `user:${row.employeeUserId}`
    : row.salaryRateId ? `rate:${row.salaryRateId}` : `payout:${row.payoutId}`
));
