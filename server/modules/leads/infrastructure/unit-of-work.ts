import type {
  AfterCommitTask,
  LeadUnitOfWork,
  LeadUnitOfWorkContext,
} from '../application/ports';

export type TransactionRunner = <T>(operation: () => Promise<T>) => Promise<T>;
export type LeadUnitOfWorkDependencies = Omit<LeadUnitOfWorkContext, 'afterCommit'>;

export const createLeadUnitOfWork = (
  dependencies: LeadUnitOfWorkDependencies,
  runTransaction: TransactionRunner,
): LeadUnitOfWork => ({
  async execute<T>(operation: (context: LeadUnitOfWorkContext) => Promise<T>): Promise<T> {
    const afterCommitTasks: AfterCommitTask[] = [];
    const result = await runTransaction(() => operation({
      ...dependencies,
      afterCommit: (task) => afterCommitTasks.push(task),
    }));

    for (const task of afterCommitTasks) {
      await task();
    }
    return result;
  },
});
