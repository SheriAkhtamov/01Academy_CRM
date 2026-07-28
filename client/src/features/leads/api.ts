import type { CreateAcademyLeadRequest } from '@shared/contracts/academy-leads';
import { apiRequest } from '@/lib/queryClient';

export const leadsApi = {
  create: (input: CreateAcademyLeadRequest) => (
    apiRequest('POST', '/api/academy/leads', input)
  ),
};
