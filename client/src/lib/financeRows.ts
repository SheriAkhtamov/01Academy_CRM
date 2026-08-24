export type Row = Record<string, any>;

export type ExpenseRegistryRow = Row & { entryKind: 'operating' | 'marketing' };
