import type { LearningCapabilitiesDto } from '@shared/contracts/learning-rollout';
import { apiRequest } from '@/lib/queryClient';

export const learningCapabilitiesQuery = {
  queryKey: ['learning-capabilities'] as const,
  queryFn: (): Promise<LearningCapabilitiesDto> => apiRequest('GET', '/api/lms-management/status'),
  staleTime: 30_000,
};
