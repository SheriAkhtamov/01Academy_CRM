import { apiRequest } from '@/lib/queryClient';
import type { SalesDemoStudent } from '@shared/contracts/sales-demo-students';

export const getSalesDemoStudents = (
  queryString: string,
): Promise<SalesDemoStudent[]> => apiRequest('GET', `/api/academy/modules/sales/demo-students?${queryString}`);
