import { Router } from 'express';
import { hasLeadershipAccess } from '@shared/academy';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import {
  LEAD_MODULES,
  createAudit,
  ensureLeadMutationAccess,
  ensureModuleAccess,
  normalizePhoneForStorage,
  nullableText,
  parseId,
  queryOne,
  updateRow,
  withTransaction,
} from './academy-core';
import { getLead } from './academy-leads';

export const registerAcademyStudentProfileRoutes = (router: ReturnType<typeof Router>) => {
  router.patch('/students/:id', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Student update access required')) return;
    try {
      const studentId = parseId(req.params.id);
      if (!studentId) return res.status(400).json({ error: 'Invalid student id' });

      const studentName = nullableText(req.body.studentName);
      if (!studentName) return res.status(400).json({ error: 'studentNameRequired' });
      const parsedStudentAge = req.body.studentAge === undefined
        || req.body.studentAge === null
        || req.body.studentAge === ''
        ? null
        : Number(req.body.studentAge);
      if (
        parsedStudentAge !== null
        && (!Number.isInteger(parsedStudentAge) || parsedStudentAge < 1 || parsedStudentAge > 120)
      ) {
        return res.status(400).json({ error: 'invalidStudentAge' });
      }
      const requestedPhone = nullableText(req.body.phone);
      const normalizedPhone = requestedPhone ? normalizePhoneForStorage(requestedPhone) : null;
      if (
        requestedPhone
        && (!normalizedPhone || normalizedPhone.normalizedPhone.replace(/\D/g, '').length < 7)
      ) {
        return res.status(400).json({ error: 'invalidStudentPhone' });
      }

      const initialStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1`,
        [studentId],
      );
      if (!initialStudent) return res.status(404).json({ error: 'Student not found' });
      const initialLead = initialStudent.leadId
        ? await getLead(Number(initialStudent.leadId))
        : null;
      if (initialLead) {
        if (!ensureLeadMutationAccess(req, res, initialLead)) return;
      } else if (!hasLeadershipAccess(req.user)) {
        return res.status(403).json({ error: 'Student update access required' });
      }

      const student = await withTransaction(async () => {
        if (initialStudent.leadId) {
          await queryOne(
            `SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`,
            [initialStudent.leadId],
          );
        }
        const lockedStudent = await queryOne(
          `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
          [studentId],
        );
        if (!lockedStudent) {
          throw Object.assign(new Error('Student not found'), { statusCode: 404 });
        }
        const updatedStudent = await updateRow('academy_students', studentId, {
          studentName,
          studentAge: parsedStudentAge,
          phone: normalizedPhone?.phone ?? null,
        });
        if (!updatedStudent) {
          throw Object.assign(new Error('Student not found'), { statusCode: 404 });
        }
        return { previous: lockedStudent, updated: updatedStudent };
      });

      await createAudit(
        req,
        'UPDATE_ACADEMY_STUDENT_DETAILS',
        'academy_student',
        studentId,
        student.updated,
        student.previous,
      );
      res.json(student.updated);
    } catch (error: any) {
      logger.error('Failed to update student details', { error, studentId: req.params.id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to update student'),
      });
    }
  });
};
