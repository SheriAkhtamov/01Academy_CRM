import type { LearningCapabilitiesDto, LearningFlagUpdateInput, LearningRolloutDto } from '@shared/contracts/learning-rollout';
import { apiRequest } from '@/lib/queryClient';
import type { LearningSchoolSettingsUpdate, LearningSchoolSettingsDto } from '@shared/contracts/learning-settings';

export const learningCapabilitiesQuery = {
  queryKey: ['learning-capabilities'] as const,
  queryFn: (): Promise<LearningCapabilitiesDto> => apiRequest('GET', '/api/lms-management/status'),
  staleTime: 30_000,
};
export const learningRolloutApi = {
  configuration: (): Promise<LearningRolloutDto> => apiRequest('GET', '/api/lms-management/configuration'),
  update: (input: LearningFlagUpdateInput): Promise<LearningRolloutDto> => apiRequest('PUT', '/api/lms-management/configuration', input),
  schoolSettings: (): Promise<LearningSchoolSettingsDto> => apiRequest('GET','/api/lms-management/school-settings'),
  updateSchoolSettings: (input: LearningSchoolSettingsUpdate): Promise<LearningSchoolSettingsDto> => apiRequest('PUT','/api/lms-management/school-settings',input),
};
