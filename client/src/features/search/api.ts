import { apiRequest } from '@/lib/queryClient';
import type { AcademySearchPage, AcademySearchType } from '@shared/contracts/academy-search';

export const searchAcademy = (term: string, type: AcademySearchType | 'all', offset: number): Promise<AcademySearchPage> => {
  const params = new URLSearchParams({ q: term, type, offset: String(offset), limit: type === 'all' ? '3' : '8', grouped: '1' });
  return apiRequest('GET', `/api/academy/search?${params}`);
};
