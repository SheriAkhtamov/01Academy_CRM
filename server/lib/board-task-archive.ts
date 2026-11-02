/** Correlated predicate shared by board readers and reminder workers. */
export const boardTaskEmployeeArchiveSql = (alias: 'board_tasks' | 'task') =>
  `EXISTS (SELECT 1 FROM users archived_employee
    WHERE archived_employee.id IN (${alias}.creator_id, ${alias}.assignee_id)
      AND archived_employee.is_archived IS TRUE)`;
