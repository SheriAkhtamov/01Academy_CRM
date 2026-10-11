import type { Request, RequestHandler } from "express";
import type { ZodTypeAny, output } from "zod";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type { LmsStaffActor } from "../domain/policy";
import { LmsError } from "../domain/policy";
export type LmsPortalActorResolver = (
  request: Request,
  linkId: number,
) => Promise<PortalActorContext>;
export type LmsStaffActorResolver = (
  request: Request,
) => Promise<LmsStaffActor>;
export type LmsFeatureGate = (
  request: Request,
  actor?: PortalActorContext | LmsStaffActor,
) => boolean | Promise<boolean>;
export const readInput = <T extends ZodTypeAny>(
  schema: T,
  value: unknown,
): output<T> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues.find((item) =>
      /^lms[A-Z]/.test(item.message),
    );
    const error = new LmsError(issue?.message ?? "lmsInvalidRequest");
    error.fieldErrors = Object.fromEntries(
      parsed.error.issues.map((item) => [
        item.path.join("."),
        /^lms[A-Z]/.test(item.message) ? item.message : "lmsInvalidRequest",
      ]),
    );
    throw error;
  }
  return parsed.data;
};
export function lmsHandler(
  action: (request: Request) => Promise<unknown>,
  gate: LmsFeatureGate = () => false,
): RequestHandler {
  return async (request, response) => {
    response.set("Cache-Control", "private, no-store");
    try {
      if (!(await gate(request)))
        return response.status(404).json({ code: "portalUnavailable" });
      response.json(await action(request));
    } catch (error) {
      const record = error as {
        statusCode?: number;
        status?: number;
        code?: string;
        fieldErrors?: Record<string, string>;
      };
      const status = record.statusCode ?? record.status ?? 500;
      response.status(status).json({
        code:
          status < 500
            ? (record.code ?? "lmsInvalidRequest")
            : "lmsRequestFailed",
        ...(status < 500 && record.fieldErrors
          ? { fieldErrors: record.fieldErrors }
          : {}),
      });
    }
  };
}
