import { updateAcademyLeadRequestSchema } from '@shared/contracts/academy-leads';
import { nullableText } from './academy-core';

const leadPreferenceUpdateSchema = updateAcademyLeadRequestSchema.pick({
  locality: true,
  studyDays: true,
  studyTime: true,
  goal: true,
  urgency: true,
});

export const parseLeadPreferenceUpdates = (body: unknown) => {
  const parsed = leadPreferenceUpdateSchema.safeParse(body);
  if (!parsed.success) return null;
  const { locality, studyDays, studyTime, goal, urgency } = parsed.data;
  return {
    locality,
    studyDays,
    studyTime,
    goal: goal === undefined ? undefined : nullableText(goal),
    urgency: urgency === undefined ? undefined : nullableText(urgency),
  };
};
