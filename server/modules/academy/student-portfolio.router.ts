import path from "node:path";
import type { Router, RequestHandler } from "express";
import { hasLeadershipAccess } from "@shared/academy";
import { studentProjectRequestSchema } from "@shared/contracts/student-profile";
import { attachmentUploadLimiter } from "../../middleware/rateLimiter";
import {
  parseStudentProjectUpload,
  removeStudentProjectFile,
  studentProjectFilePath,
  studentProjectFileInfo,
} from "../../middleware/student-project-upload.middleware";
import { logger } from "../../lib/logger";
import {
  createAudit,
  insertRow,
  queryOne,
  withTransaction,
} from "./academy-core";
import {
  loadAuthorizedStudent,
  presentLegacyStudentProject,
} from "./student-profile-data";

const authorizeUpload: RequestHandler = async (req, res, next) => {
  try {
    if (await loadAuthorizedStudent(req, res, true)) next();
  } catch (error) {
    next(error);
  }
};
export function registerStudentPortfolioRoutes(router: Router) {
  router.post(
    "/students/:id/projects",
    authorizeUpload,
    attachmentUploadLimiter,
    parseStudentProjectUpload,
    async (req, res) => {
      let stored = false;
      try {
        const parsed = studentProjectRequestSchema.safeParse({
          title: req.body?.title,
          url: req.body?.url || undefined,
        });
        if (!parsed.success) {
          const key =
            parsed.error.issues[0]?.path[0] === "title"
              ? "studentProjectTitleRequired"
              : "studentProjectInvalidLink";
          return res.status(400).json({ error: key });
        }
        if (!req.file && !parsed.data.url)
          return res
            .status(400)
            .json({ error: "studentProjectSourceRequired" });
        const project = await withTransaction(async () => {
          const authorized = await loadAuthorizedStudent(req, res, true);
          if (!authorized) return null;
          const student = await queryOne(
            `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
            [authorized.student.id],
          );
          if (!student) return null;
          const isTeacher = Boolean(authorized.teacherId);
          if (
            !hasLeadershipAccess(req.user) &&
            !isTeacher &&
            Number(student.managerId) !== req.user!.id
          ) {
            res.status(403).json({ error: "Student access required" });
            return null;
          }
          const targetGroup = await queryOne(
            `SELECT group_id, (SELECT course_id FROM academy_groups WHERE id = membership.group_id) AS course_id
             FROM academy_student_group_enrollments membership
             WHERE student_id = $1 AND status = 'active'
             ORDER BY is_primary DESC, id DESC LIMIT 1`,
            [student.id],
          );
          const originalName = req.file
            ? path
                .basename(
                  String(req.body.fileName || req.file.originalname).replace(
                    /\\/g,
                    "/",
                  ),
                )
                .replace(/[\u0000-\u001f\u007f]/g, "")
                .slice(0, 255)
            : null;
          const fileUrl = req.file
            ? `/api/academy/students/${student.id}/projects/files/${req.file.filename}?name=${encodeURIComponent(originalName || parsed.data.title)}`
            : null;
          const created = await insertRow("academy_portfolio_projects", {
            studentId: student.id,
            groupId: student.groupId ?? (targetGroup ? Number(targetGroup.groupId) : null),
            courseId: student.courseId ?? (targetGroup?.courseId ? Number(targetGroup.courseId) : null),
            title: parsed.data.title,
            url: parsed.data.url ?? null,
            fileUrl,
            finalStatus: "completed",
          });
          await createAudit(
            req,
            "CREATE_STUDENT_PROJECT",
            "academy_student",
            Number(student.id),
            created,
          );
          return created;
        });
        if (!project) {
          if (!res.headersSent)
            res.status(404).json({ error: "Student not found" });
          return;
        }
        stored = true;
        res
          .status(201)
          .json(
            presentLegacyStudentProject(
              project as import("@shared/contracts/student-profile").StudentProject,
            ),
          );
      } catch (error) {
        logger.error("Failed to add student project", {
          error,
          studentId: req.params.id,
        });
        if (!res.headersSent)
          res.status(500).json({ error: "studentProjectSaveFailed" });
      } finally {
        if (!stored)
          await removeStudentProjectFile(req.file).catch((error) =>
            logger.error("Failed to remove uncommitted student project file", {
              error,
            }),
          );
      }
    },
  );
  router.get("/students/:id/projects/files/:fileId", async (req, res) => {
    try {
      const authorized = await loadAuthorizedStudent(req, res);
      if (!authorized) return;
      const filePath = studentProjectFilePath(req.params.fileId);
      if (!filePath) return res.status(404).json({ error: "resourceNotFound" });
      const project = await queryOne(
        `SELECT file_url FROM academy_portfolio_projects project
        WHERE student_id = $1 AND split_part(file_url, '?', 1) = $2
        ${authorized.teacherId ? `AND (project.group_id IS NULL OR project.group_id IN (
          SELECT id FROM academy_groups WHERE teacher_id = $3
          OR EXISTS (SELECT 1 FROM academy_lessons l WHERE l.group_id = academy_groups.id AND l.teacher_id = $3)
          OR EXISTS (SELECT 1 FROM academy_lessons l JOIN academy_lesson_assistants a ON a.lesson_id = l.id WHERE l.group_id = academy_groups.id AND a.teacher_id = $3)
        ))` : ""} LIMIT 1`,
        [
          authorized.student.id,
          `/api/academy/students/${authorized.student.id}/projects/files/${req.params.fileId}`,
          ...(authorized.teacherId ? [authorized.teacherId] : []),
        ],
      );
      const info = studentProjectFileInfo(project?.fileUrl);
      if (!info) return res.status(404).json({ error: "resourceNotFound" });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, no-store");
      res.download(filePath, info.fileName, (error) => {
        if (error && !res.headersSent)
          res.status(404).json({ error: "attachmentDownloadFailed" });
      });
    } catch (error) {
      logger.error("Failed to download student project", {
        error,
        studentId: req.params.id,
      });
      if (!res.headersSent)
        res.status(500).json({ error: "attachmentDownloadFailed" });
    }
  });
}
