import type { DemoParticipantCard } from '@shared/contracts/demo-lessons';
import { queryOne } from './academy-core';

/** The relationship is checked in SQL; this never grants ordinary lead access. */
export const getDemoParticipantCard = (demoLessonId: number, participantId: number) => queryOne<DemoParticipantCard>(
  `SELECT demo.id AS demo_lesson_id, participant.id AS participant_id,
    CASE WHEN lead.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', lead.id, 'contactName', lead.contact_name,
      'phone', CASE WHEN lead.phone NOT LIKE 'instagram:%' THEN lead.phone END,
      'managerName', lead_manager.full_name, 'statusName', lead_status.name,
      'sourceName', source.name, 'courseName', lead_course.name,
      'goal', lead.goal, 'urgency', lead.urgency, 'comment', lead.comment
    ) END AS lead,
    jsonb_build_object(
      'id', student.id, 'studentName', COALESCE(NULLIF(BTRIM(student.student_name), ''), lead.student_name),
      'studentAge', student.student_age, 'contactName', student.contact_name,
      'phone', CASE WHEN student.phone NOT LIKE 'instagram:%' THEN student.phone END,
      'managerName', COALESCE(student_manager.full_name, lead_manager.full_name),
      'courseName', student_course.name, 'schoolName', school.name, 'groupName', study_group.name
    ) AS student
   FROM academy_demo_lessons demo
   JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
   JOIN academy_students student ON student.id = participant.student_id
   LEFT JOIN academy_leads lead ON lead.id = student.lead_id
   LEFT JOIN users lead_manager ON lead_manager.id = lead.manager_id
   LEFT JOIN users student_manager ON student_manager.id = student.manager_id
   LEFT JOIN academy_lead_statuses lead_status ON lead_status.code = lead.status_code
   LEFT JOIN academy_lead_sources source ON source.id = lead.source_id
   LEFT JOIN academy_courses lead_course ON lead_course.id = lead.course_id
   LEFT JOIN academy_courses student_course ON student_course.id = student.course_id
   LEFT JOIN academy_schools school ON school.id = student.school_id
   LEFT JOIN academy_groups study_group ON study_group.id = student.group_id
   WHERE demo.id = $1 AND participant.id = $2`,
  [demoLessonId, participantId],
);
