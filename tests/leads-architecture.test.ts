import { describe, expect, it, vi } from 'vitest';
import {
  archiveLeadRequestSchema,
  bulkArchiveLeadsRequestSchema,
  bulkAssignLeadsRequestSchema,
  bulkDeleteLeadsRequestSchema,
  bulkUpdateLeadStatusRequestSchema,
  createLeadStudentRequestSchema,
  leadCommentRequestSchema,
  mergeLeadIdsSchema,
  updateAcademyLeadRequestSchema,
} from '../shared/contracts/academy-leads';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';
import {
  canActorMutateLead,
  canActorViewLead,
} from '../server/modules/leads/domain/access-policy';
import type { LeadUnitOfWorkDependencies } from '../server/modules/leads/infrastructure/unit-of-work';
import { createLeadUnitOfWork } from '../server/modules/leads/infrastructure/unit-of-work';
import { createLeadMergeService } from '../server/modules/leads/application/merge-service';
import type { LeadMergeRepository } from '../server/modules/leads/application/ports';
import { createLeadAssignmentService } from '../server/modules/leads/application/assignment-service';
import { createLeadLifecycleService } from '../server/modules/leads/application/lifecycle-service';

describe('lead actor context and access policy', () => {
  it('normalizes module assignments without carrying an Express request', () => {
    expect(actorContextFrom({
      id: 17,
      module: 'sales',
      modules: ['sales', 'finance'],
    })).toEqual({
      userId: 17,
      primaryModule: 'sales',
      modules: ['sales', 'finance'],
      isLeadership: false,
    });
  });

  it('keeps own/unassigned lead access and leadership overrides compatible', () => {
    const salesperson = actorContextFrom({ id: 7, module: 'sales' });
    const administration = actorContextFrom({ id: 1, module: 'administration' });
    const teacher = actorContextFrom({ id: 9, module: 'teacher' });

    expect(canActorViewLead(salesperson, { managerId: 7 })).toBe(true);
    expect(canActorMutateLead(salesperson, { managerId: null })).toBe(true);
    expect(canActorViewLead(salesperson, { managerId: 8 })).toBe(false);
    expect(canActorMutateLead(administration, { managerId: 8 })).toBe(true);
    expect(canActorViewLead(teacher, { managerId: 9 })).toBe(false);
  });
});

describe('lead unit of work', () => {
  const dependencies = {} as LeadUnitOfWorkDependencies;

  it('runs queued effects only after the transaction commits', async () => {
    const order: string[] = [];
    const unitOfWork = createLeadUnitOfWork(dependencies, async (operation) => {
      order.push('begin');
      const result = await operation();
      order.push('commit');
      return result;
    });

    const result = await unitOfWork.execute(async ({ afterCommit }) => {
      order.push('write');
      afterCommit(() => {
        order.push('realtime');
      });
      return 42;
    });

    expect(result).toBe(42);
    expect(order).toEqual(['begin', 'write', 'commit', 'realtime']);
  });

  it('does not run queued effects when the transaction rolls back', async () => {
    const effect = vi.fn();
    const unitOfWork = createLeadUnitOfWork(dependencies, async (operation) => operation());

    await expect(unitOfWork.execute(async ({ afterCommit }) => {
      afterCommit(effect);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(effect).not.toHaveBeenCalled();
  });
});

describe('lead merge use cases', () => {
  const actor = actorContextFrom({ id: 1, module: 'administration' });

  it('enforces leadership for discovery without reaching persistence', async () => {
    const repository = { search: vi.fn() } as unknown as LeadMergeRepository;
    const service = createLeadMergeService(repository, vi.fn());

    await expect(service.search(
      actorContextFrom({ id: 2, module: 'sales' }),
      'parent',
    )).rejects.toMatchObject({ message: 'Admin access required', statusCode: 403 });
    expect(repository.search).not.toHaveBeenCalled();
  });

  it('publishes assignment notification only after a successful draft merge', async () => {
    const repository = {
      mergeDraft: vi.fn().mockResolvedValue({
        retainedLead: { id: 12, contactName: 'Parent' },
        assignedManager: { id: 8, fullName: 'Manager' },
      }),
      present: vi.fn().mockResolvedValue({ id: 12, contactName: 'Parent' }),
    } as unknown as LeadMergeRepository;
    const notify = vi.fn().mockResolvedValue(undefined);
    const service = createLeadMergeService(repository, notify);

    await expect(service.mergeDraft(actor, 12, { contactName: 'Parent' }))
      .resolves.toEqual({ id: 12, contactName: 'Parent' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      managerId: 8,
      leadId: 12,
    }));

    repository.mergeDraft = vi.fn().mockRejectedValue(new Error('rollback'));
    notify.mockClear();
    await expect(service.mergeDraft(actor, 12, { contactName: 'Parent' }))
      .rejects.toThrow('rollback');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('lead command permissions', () => {
  it('allows sales to self-assign but reserves cross-manager assignment for leadership', async () => {
    const repository = { assign: vi.fn().mockResolvedValue({ id: 10 }) };
    const service = createLeadAssignmentService(repository as never);
    const salesperson = actorContextFrom({ id: 7, module: 'sales' });

    await expect(service.assign(salesperson, 10, 7)).resolves.toEqual({ id: 10 });
    await expect(service.assign(salesperson, 10, 8)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Only leadership can assign a lead to another manager',
    });
    expect(repository.assign).toHaveBeenCalledTimes(1);
  });

  it('keeps hard deletion restricted to leadership', async () => {
    const repository = {
      delete: vi.fn().mockResolvedValue({ ok: true, deletedTaskCount: 0 }),
      bulkDelete: vi.fn().mockResolvedValue({ ok: true, deletedCount: 2, deletedTaskCount: 0 }),
    };
    const service = createLeadLifecycleService(repository);

    await expect(service.delete(actorContextFrom({ id: 7, module: 'sales' }), 10))
      .rejects.toMatchObject({ statusCode: 403, message: 'Admin access required' });
    await expect(service.bulkDelete(actorContextFrom({ id: 7, module: 'sales' }), [10, 11]))
      .rejects.toMatchObject({ statusCode: 403, message: 'Admin access required' });
    expect(repository.delete).not.toHaveBeenCalled();
    expect(repository.bulkDelete).not.toHaveBeenCalled();
  });
});

describe('lead boundary contracts', () => {
  it('normalizes assignment, merge and destructive action inputs', () => {
    expect(bulkAssignLeadsRequestSchema.parse({
      leadIds: ['1', 2, 2],
      managerId: '8',
      comment: '  transfer  ',
    })).toMatchObject({ leadIds: [1, 2, 2], managerId: 8, comment: 'transfer' });
    expect(bulkUpdateLeadStatusRequestSchema.parse({
      leadIds: ['1', 2],
      statusCode: ' qualified ',
    })).toEqual({ leadIds: [1, 2], statusCode: 'qualified' });
    expect(bulkDeleteLeadsRequestSchema.parse({ leadIds: ['1', 2] }))
      .toEqual({ leadIds: [1, 2] });
    expect(bulkArchiveLeadsRequestSchema.parse({
      leadIds: ['1', 2],
      reason: ' no_answer ',
      assignToSelf: true,
    })).toEqual({ leadIds: [1, 2], reason: 'no_answer', assignToSelf: true });
    expect(mergeLeadIdsSchema.parse({ retainedLeadId: '1', duplicateLeadId: '2' }))
      .toEqual({ retainedLeadId: 1, duplicateLeadId: 2 });
    expect(mergeLeadIdsSchema.safeParse({ retainedLeadId: 1, duplicateLeadId: 1 }).success)
      .toBe(false);
    expect(archiveLeadRequestSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('validates comments, students and optimistic updates at the shared boundary', () => {
    expect(leadCommentRequestSchema.parse({ body: '  called parent  ' }))
      .toEqual({ body: 'called parent' });
    const longComment = 'x'.repeat(100_000);
    expect(leadCommentRequestSchema.parse({ body: longComment }).body)
      .toHaveLength(longComment.length);
    expect(leadCommentRequestSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createLeadStudentRequestSchema.safeParse({
      studentName: 'Student',
      groupIds: [4],
      primaryGroupId: 4,
      enrolledAt: '2026-08-01',
    }).success).toBe(true);
    expect(updateAcademyLeadRequestSchema.safeParse({
      expectedUpdatedAt: '2026-08-01T10:00:00.000Z',
      statusCode: 'qualified',
      legacyCompatibleField: true,
    }).success).toBe(true);
  });
});
