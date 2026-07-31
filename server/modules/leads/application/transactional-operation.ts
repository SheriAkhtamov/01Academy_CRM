import type {
  LeadUnitOfWork,
  LeadUnitOfWorkContext,
} from './ports';

export const executeLeadOperation = <T>(
  unitOfWork: LeadUnitOfWork,
  operation: (context: LeadUnitOfWorkContext) => Promise<T>,
): Promise<T> => unitOfWork.execute(operation);
