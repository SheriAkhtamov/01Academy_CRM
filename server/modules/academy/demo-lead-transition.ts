import type { ActorSource } from '../leads/domain/actor-context';
import { queryOne, type Row } from './academy-core';

/** Attendance updates the attendance fact; it never chooses a sales stage or funnel. */
export const recordDemoLeadAttendance = async (
  _source: ActorSource,
  lead: Row,
  demoAttended: boolean,
): Promise<Row> => {
  const updated = await queryOne(
    `UPDATE academy_leads SET demo_attended = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [lead.id, demoAttended],
  );
  if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  return updated;
};
