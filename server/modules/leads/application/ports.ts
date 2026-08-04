import type { ActorContext } from '../domain/actor-context';

export type LeadRecord = Record<string, unknown> & { id: number };
export type LeadMergeResult = {
  retainedLead: LeadRecord;
  duplicateLeadId: number;
  moved: Record<string, unknown>;
};

export interface LeadRepository {
  findById(id: number): Promise<LeadRecord | null>;
  list(actor: ActorContext): Promise<LeadRecord[]>;
  create(values: Record<string, unknown>): Promise<LeadRecord>;
  update(id: number, values: Record<string, unknown>): Promise<LeadRecord | null>;
  delete(id: number): Promise<boolean>;
}

export interface LeadAssignmentRepository {
  assign(
    leadId: number,
    managerId: number,
    actor: ActorContext,
    comment?: string | null,
  ): Promise<LeadRecord>;
}

export interface LeadBulkAssignmentRepository {
  bulkAssign(
    leadIds: readonly number[],
    managerId: number,
    actor: ActorContext,
  ): Promise<LeadRecord[]>;
}

export interface LeadMergeRepository {
  search(term: string): Promise<LeadRecord[]>;
  preview(firstLeadId: number, secondLeadId: number, actor: ActorContext): Promise<LeadRecord[]>;
  merge(retainedLeadId: number, duplicateLeadId: number, actor: ActorContext): Promise<LeadMergeResult>;
  mergeDraft(
    retainedLeadId: number,
    draft: Record<string, unknown>,
    actor: ActorContext,
  ): Promise<{
    retainedLead: LeadRecord;
    assignedManager: { id: number; fullName: string } | null;
  }>;
  present(lead: LeadRecord, actor: ActorContext): Promise<LeadRecord>;
}

export interface LeadRelationsRepository {
  addTag(leadId: number, input: Record<string, unknown>, actor: ActorContext): Promise<unknown>;
  removeTag(leadId: number, assignmentId: number, actor: ActorContext): Promise<unknown>;
  addComment(leadId: number, body: string, actor: ActorContext): Promise<unknown>;
}

export interface LeadGroupRepository {
  addGroup(leadId: number, groupId: number, actor: ActorContext): Promise<LeadRecord>;
  removeGroup(leadId: number, groupId: number, actor: ActorContext): Promise<LeadRecord>;
}

export interface LeadLifecycleRepository {
  delete(leadId: number, actor: ActorContext): Promise<{
    ok: true;
    deletedTaskCount: number;
  }>;
}

export type AuditEvent = {
  actor: ActorContext;
  action: string;
  entityType: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
};

export interface AuditPort { record(event: AuditEvent): Promise<void> }
export interface NotificationPort { publish(input: Record<string, unknown>): Promise<void> }
export interface TaskPort { create(input: Record<string, unknown>): Promise<unknown> }
export interface RealtimePort { publish(input: Record<string, unknown>): void }
export interface AutomationPort { run(input: Record<string, unknown>): Promise<void> }
export interface TelephonyPort { execute(input: Record<string, unknown>): Promise<unknown> }

export type AfterCommitTask = () => void | Promise<void>;

export type LeadUnitOfWorkContext = {
  leads: LeadRepository;
  assignments: LeadAssignmentRepository;
  merges: LeadMergeRepository;
  relations: LeadRelationsRepository;
  audit: AuditPort;
  notifications: NotificationPort;
  tasks: TaskPort;
  afterCommit(task: AfterCommitTask): void;
};

export interface LeadUnitOfWork {
  execute<T>(operation: (context: LeadUnitOfWorkContext) => Promise<T>): Promise<T>;
}
