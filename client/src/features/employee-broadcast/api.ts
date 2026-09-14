import type {
  EmployeeBroadcastRequest,
  EmployeeBroadcastResult,
} from '@shared/contracts/employee-broadcast';
import { apiRequest } from '@/lib/queryClient';

export const sendEmployeeBroadcast = (request: EmployeeBroadcastRequest) => (
  apiRequest('POST', '/api/notifications/broadcast', request) as Promise<EmployeeBroadcastResult>
);
