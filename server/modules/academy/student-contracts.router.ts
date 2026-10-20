import fs from "node:fs/promises";
import path from "node:path";
import type { Request, RequestHandler, Router } from "express";
import { z } from "zod";
import {
  studentContractUpdateSchema, studentContractVersionSchema,
} from "@shared/contracts/student-contracts";
import { attachmentUploadLimiter } from "../../middleware/rateLimiter";
import { createResourceUploadParser } from "../portal-resources/infrastructure/upload-parser";
import { actorContextFrom } from "../leads/domain/actor-context";
import { StudentContractError, StudentContractService } from "./student-contracts";
import { logger } from "../../lib/logger";

type ContractService = Pick<StudentContractService, "get" | "forStudent" | "create" | "changeNumber" | "cancel" | "upload" | "download">;
const actor = (request: Request) => request.actor ?? actorContextFrom(request.user);
const uuid = (value: string) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new StudentContractError("studentContractNotFound", 404);
  return parsed.data;
};
const numericId = (value: string) => {
  const parsed = z.coerce.number().int().positive().safeParse(value);
  if (!parsed.success) throw new StudentContractError("studentContractNotFound", 404);
  return parsed.data;
};
const version = (body: unknown) => {
  const parsed = studentContractVersionSchema.safeParse(body);
  if (!parsed.success) throw new StudentContractError("invalidData");
  return parsed.data.version;
};
const uploadedName = (value: string) => {
  if (![...value].every(character => character.charCodeAt(0) <= 255) || !/[\u0080-\u00ff]/.test(value)) return value;
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
};
const handled = (operation: RequestHandler): RequestHandler => async (request, response, next) => {
  try { await operation(request, response, next); }
  catch (error) {
    if (error instanceof StudentContractError) {
      response.status(error.statusCode).json({ error: error.code });
    } else if ((error as { code?: string })?.code === "23505") {
      response.status(409).json({ error: "studentContractNumberTaken" });
    } else {
      logger.error("Student contract request failed", { error });
      response.status(500).json({ error: "studentContractSaveFailed" });
    }
  }
};

export function registerStudentContractRoutes(
  router: Router,
  service: ContractService = new StudentContractService(),
  parser: RequestHandler = createResourceUploadParser(path.resolve("uploads/contracts/quarantine")),
) {
  router.get("/students/:id/contract", handled(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await service.forStudent(actor(request), numericId(request.params.id)));
  }));
  router.post("/students/:id/contract", handled(async (request, response) => {
    response.status(201).json(await service.create(actor(request), { studentId: numericId(request.params.id) }));
  }));
  router.post("/leads/:id/contract-drafts", handled(async (request, response) => {
    response.status(201).json(await service.create(actor(request), { leadId: numericId(request.params.id) }));
  }));
  router.get("/student-contracts/:id", handled(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await service.get(actor(request), uuid(request.params.id)));
  }));
  router.patch("/student-contracts/:id", handled(async (request, response) => {
    const parsed = studentContractUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new StudentContractError("studentContractNumberInvalid");
    response.json(await service.changeNumber(actor(request), uuid(request.params.id), parsed.data.version, parsed.data.number));
  }));
  router.post("/student-contracts/:id/regenerate", handled(async (request, response) => {
    response.json(await service.changeNumber(actor(request), uuid(request.params.id), version(request.body)));
  }));
  router.delete("/student-contracts/:id", handled(async (request, response) => {
    await service.cancel(actor(request), uuid(request.params.id), version(request.body));
    response.sendStatus(204);
  }));
  // Reject inaccessible IDs before reading multipart bytes. The service repeats
  // authorization while holding the current lead/student/contract locks.
  const authorizeUpload: RequestHandler = handled(async (request, _response, next) => {
    await service.get(actor(request), uuid(request.params.id), true);
    next();
  });
  router.post("/student-contracts/:id/file", authorizeUpload, attachmentUploadLimiter, parser,
    handled(async (request, response) => {
      try {
        if (!request.file) throw new StudentContractError("studentContractFileRequired");
        const currentVersion = version({ version: Number(request.body.version) });
        response.json(await service.upload(actor(request), uuid(request.params.id), currentVersion,
          request.file.path, uploadedName(request.file.originalname)));
      } finally {
        if (request.file) await fs.unlink(request.file.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") logger.error("Failed to remove temporary student contract file", { error });
        });
      }
    }));
  router.get("/student-contracts/:id/file", handled(async (request, response) => {
    const result = await service.download(actor(request), uuid(request.params.id));
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Cache-Control", "private, no-store");
    response.download(result.path, result.file.name, error => {
      if (error && !response.headersSent) response.status(404).json({ error: "studentContractNotFound" });
    });
  }));
}
