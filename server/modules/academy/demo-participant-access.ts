import { hasLeadershipAccess } from '@shared/academy';
import { actorContextFrom, type ActorSource } from '../leads/domain/actor-context';

export const demoAttendanceManagerSql = (leadAlias = 'lead') => `COALESCE(
  (SELECT tracked.hunter_id FROM academy_sales_kpi_leads tracked WHERE tracked.lead_id = ${leadAlias}.id),
  (SELECT handoff.from_manager_id FROM academy_lead_funnel_handoffs handoff
   WHERE handoff.lead_id = ${leadAlias}.id AND handoff.returned_at IS NULL)
)`;

export const demoFunnelRoleSql = (leadAlias = 'lead') => `(SELECT funnel.workflow_role
  FROM academy_sales_funnels funnel WHERE funnel.id = ${leadAlias}.funnel_id)`;

export function canManageDemoParticipant(source: ActorSource, participant: {
  managerId?: number | null; attendanceManagerId?: number | null; funnelRole?: string | null;
}) {
  const actor = actorContextFrom(source);
  return hasLeadershipAccess(actor)
    || Number(participant.managerId) === actor.userId
    || Number(participant.attendanceManagerId) === actor.userId
    || (!participant.managerId && participant.funnelRole !== 'closer');
}
