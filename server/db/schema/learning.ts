import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createPortalIdentityTables } from "./learning-identity";
import { createLmsContentTables } from "./learning-content";
import { createLmsResourceTables } from "./learning-resources";
export { createLearningPortfolioColumns, createLearningPortfolioConstraints } from "./learning-portfolio-columns";

export type LearningSchemaReferences = {
  userId: AnyPgColumn; studentId: AnyPgColumn; courseId: AnyPgColumn; groupId: AnyPgColumn;
  lessonId: AnyPgColumn; enrollmentId: AnyPgColumn; projectId: AnyPgColumn; paymentId: AnyPgColumn;
};
/** Server-only schema. SQL migrations remain authoritative for relational and history triggers. */
export function createLearningTables(refs: LearningSchemaReferences) {
  const identity = createPortalIdentityTables(refs);
  const content = createLmsContentTables({ ...refs, accountId: identity.portalAccounts.id });
  const resources = createLmsResourceTables({ ...refs, accountId: identity.portalAccounts.id,
    linkId: identity.portalStudentLinks.id, runId: content.lmsGroupRuns.id,
    recipientId: content.lmsAssignmentRecipients.id });
  return { ...identity, ...content, ...resources };
}
export type LearningTables = ReturnType<typeof createLearningTables>;
