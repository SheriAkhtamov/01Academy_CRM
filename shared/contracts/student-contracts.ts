import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@shared/upload-policy";

export const MAX_STUDENT_CONTRACT_BYTES = MAX_UPLOAD_BYTES;
export const STUDENT_CONTRACT_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx";
export const studentContractNumberSchema = z.string().trim().min(1).max(100)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "studentContractNumberInvalid");
export const studentContractVersionSchema = z.object({
  version: z.number().int().positive(),
});
export const studentContractUpdateSchema = studentContractVersionSchema.extend({
  number: studentContractNumberSchema,
});
export const studentContractDraftSchema = z.object({
  contractDraftId: z.string().uuid().optional(),
});
export type StudentContractFile = {
  name: string;
  mime: string;
  size: number;
  downloadUrl: string;
};
export type StudentContract = {
  id: string;
  studentId: number | null;
  number: string;
  version: number;
  file: StudentContractFile | null;
  createdAt: string;
  updatedAt: string;
};
