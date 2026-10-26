import { describe, expect, it } from 'vitest';
import { groupSalesClosureReasons } from '../server/modules/academy/sales-report-reasons';

describe('sales closure reasons', () => {
  it('combines exact labels and aliases while retaining specific explanations and the total', () => {
    const rows = groupSalesClosureReasons([
      { reason: 'duplicate_or_invalid', count: 3 }, { reason: ' ДУБЛЬ. ', count: 2 },
      { reason: 'Дубль или невалидная заявка', count: 1 },
      { reason: 'Неверный номер', count: 1 }, { reason: 'wrong_contact', count: 2 },
      { reason: 'Переезжает в ноябре', count: 1 }, { reason: '', count: 1 },
    ]);
    expect(rows).toContainEqual({ reason: 'duplicate_or_invalid', count: 6 });
    expect(rows).toContainEqual({ reason: 'wrong_contact', count: 3 });
    expect(rows).toContainEqual({ reason: 'Переезжает в ноябре', count: 1 });
    expect(rows).toContainEqual({ reason: 'unspecified', count: 1 });
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(11);
  });
});
