import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { portalDirectoryQuerySchema } from "@shared/contracts/portal-directory";
import type { PortalDirectoryRepository } from "../infrastructure/directory-repository";
import type { PortalStaffActor } from "../domain/actor-context";
import { PortalError } from "../domain/access-policy";
import { t } from "../../../lib/i18n";

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function createPortalAdminRouter({ repository, resolveStaffActor, enabled = true }: {
  repository: PortalDirectoryRepository;
  resolveStaffActor: (request: Request) => PortalStaffActor | Promise<PortalStaffActor>;
  enabled?: boolean | (() => boolean);
}) {
  const router = Router();
  const route = (work: (request: Request, response: Response, actor: PortalStaffActor) => Promise<unknown>): RequestHandler => async (request, response, next) => {
    try {
      if (!(typeof enabled === "function" ? enabled() : enabled)) throw new PortalError("portalUnavailable", 404);
      const actor = await resolveStaffActor(request);
      if (!actor.canManageAccess || !actor.modules.includes("administration")) throw new PortalError("portalAccessDenied", 403);
      response.setHeader("Cache-Control", "private, no-store");
      await work(request, response, actor);
    } catch (error) {
      if (error instanceof PortalError) response.status(error.status).json({ code: error.code, error: error.code });
      else if (error instanceof z.ZodError) response.status(400).json({ code: "portalInvalidData", error: "portalInvalidData" });
      else next(error);
    }
  };
  router.get("/access-directory", route(async (request, response) => response.json(await repository.students(portalDirectoryQuerySchema.parse(request.query)))));
  router.get("/representatives", route(async (request, response) => response.json(await repository.representatives(portalDirectoryQuerySchema.parse(request.query)))));
  router.get("/access-directory/export", route(async (request, response, actor) => {
    const locale = z.enum(["ru", "en"]).default("ru").parse(request.query.locale);
    const input = { ...request.query };
    delete input.locale;
    const query = portalDirectoryQuerySchema.parse(input);
    const rows = await repository.exportStudents(query);
    if (!rows) throw new PortalError("portalDirectoryExportLimit", 409);
    await repository.auditExport(actor.staffId, query, rows.length, actor.requestId);
    const headers = (["portalDirectoryStudent", "portalDirectoryGroups", "portalDirectorySelfAccount", "portalDirectoryRepresentatives", "portalDirectoryInvitations", "portalDirectoryLastSeen", "portalDirectoryUnverified", "portalDirectoryBlocked"] as const).map((key) => t(key, locale));
    const invitationKeys = { created: "lmsAccessInvitationCreated", sent: "lmsAccessInvitationSent", delivery_failed: "lmsAccessInvitationFailed", accepted: "lmsAccessInvitationAccepted", expired: "lmsAccessInvitationExpired", revoked: "lmsAccessInvitationRevoked" } as const;
    const content = [headers, ...rows.map((row) => [
      row.student.studentName || row.student.contactName,
      row.student.groups.map((group) => group.name).join(" | "),
      row.selfAccount?.login ?? "",
      row.representatives.map((account) => `${account.fullName} (${account.login})`).join(" | "),
      [row.selfAccount, ...row.representatives].filter((account) => account?.invitationStatus).map((account) => `${account!.login}: ${t(invitationKeys[account!.invitationStatus!], locale)}`).join(" | "),
      row.lastSeenAt ?? "", row.needsVerification ? 1 : 0, row.blocked ? 1 : 0,
    ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
    response.type("text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="portal-access.csv"');
    response.send(`\uFEFF${content}\r\n`);
  }));
  return router;
}
