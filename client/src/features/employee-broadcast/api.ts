import type {
  EmployeeBroadcastRequest,
  EmployeeBroadcastResult,
} from '@shared/contracts/employee-broadcast';
import { apiRequest } from '@/lib/queryClient';
import type { AcademyAccessModule } from '@shared/academy';

export interface BroadcastEmployee {
  id: number;
  fullName: string;
  avatarUrl?: string | null;
  email?: string | null;
  position?: string | null;
  module: string;
  modules?: AcademyAccessModule[] | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

export const listBroadcastEmployees = () => (
  apiRequest('GET', '/api/users') as Promise<BroadcastEmployee[]>
);

export const sendEmployeeBroadcast = (request: EmployeeBroadcastRequest) => (
  apiRequest('POST', '/api/notifications/broadcast', request) as Promise<EmployeeBroadcastResult>
);
