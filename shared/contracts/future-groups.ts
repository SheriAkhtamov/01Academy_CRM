import { z } from "zod";

const id = z.number().int().positive();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
export const futureGroupInputSchema = z
  .object({
    nameSuffix: z.string().trim().max(120).default(""),
    courseId: id,
    // An online group needs no branch and holds no room.
    schoolId: id.nullable(),
    deliveryMode: z.enum(["offline", "online"]).default("offline"),
    maxStudents: z.number().int().min(1).max(200),
    startDate: date.nullable(),
    teacherId: id.nullable(),
    roomId: id.nullable(),
    lessonDurationMinutes: z.number().int().min(15).max(480).default(120),
    schedule: z
      .array(
        z
          .object({
            dayOfWeek: z.number().int().min(1).max(7),
            startTime: time,
            endTime: time,
          })
          .refine((slot) => slot.endTime > slot.startTime),
      )
      .max(21)
      .default([]),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.deliveryMode === "online" || value.schoolId !== null, {
    path: ["schoolId"],
  });
export type FutureGroupInput = z.infer<typeof futureGroupInputSchema>;
export type FutureGroup = Omit<FutureGroupInput, "expectedUpdatedAt"> & {
  id: number;
  name: string;
  courseName: string;
  schoolName: string | null;
  teacherName: string | null;
  roomName: string | null;
  updatedAt: string;
  currentStudents: number;
  reservedStudents: number;
  paidMembers: number;
  paidAmountUzs: number;
  isArchived: boolean;
};
// Only a pupil created inside a lead takes a place in a group.
export const futureGroupPartySchema = z
  .object({
    kind: z.literal("student"),
    id,
  })
  .strict();
export type FutureGroupParty = z.infer<typeof futureGroupPartySchema>;
export type FutureGroupMember = FutureGroupParty & {
  leadId: number;
  studentName: string | null;
  contactName: string;
  managerName: string | null;
  paidAmountUzs: number;
  canManage: boolean;
};
