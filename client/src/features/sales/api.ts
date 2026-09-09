import { apiRequest } from '@/lib/queryClient';
import type { SalesDemoStudent } from '@/components/ux/sales-overview/types';

export const getSalesDemoStudents = (
  queryString: string,
): Promise<SalesDemoStudent[]> => apiRequest('GET', `/api/academy/modules/sales/demo-students?${queryString}`);
