import path from "node:path";
import type { RequestHandler } from "express";

export const LEARNING_PROCESS_ROLES = [
  "api",
  "lifecycle",
  "notifications",
  "credentials",
  "files",
  "maintenance",
] as const;
export type LearningProcessRole = (typeof LEARNING_PROCESS_ROLES)[number];
export type LearningExecution = {
  mode: "api" | "worker";
  roles: readonly LearningProcessRole[];
  fileWrites?: "local" | "external";
};
export type LearningWorkerOptions = LearningExecution & {
  mode: "worker";
  poolMax: number;
  healthFile: string;
  healthCheck: boolean;
};
type Environment = Record<string, string | undefined>;
/** Leave a spare connection for authorization callbacks inside held transactions. */
export const minimumLearningPoolSize = (
  roles: readonly LearningProcessRole[],
) =>
  Math.max(
    roles.includes("api") ? 2 : 1,
    1 +
      roles.reduce(
        (count, role) => count + (role === "api" ? 0 : 1),
        0,
      ),
  );
export type LearningApiScope = "all" | "reports" | "files";
export type LearningApiOptions = LearningExecution & {
  scope: LearningApiScope;
  poolMax: number;
};

export function validateLearningRoles(
  value: readonly string[],
  mode: LearningExecution["mode"],
): readonly LearningProcessRole[] {
  if (
    !value.length ||
    value.some(
      (role) => !LEARNING_PROCESS_ROLES.includes(role as LearningProcessRole),
    )
  )
    throw new Error("LMS process roles must use the declared role allowlist");
  if (new Set(value).size !== value.length)
    throw new Error("LMS process roles must not contain duplicates");
  if ((mode === "api") !== value.includes("api"))
    throw new Error(
      mode === "api"
        ? "LMS API process roles must include api"
        : "LMS workers must not include api",
    );
  return Object.freeze([...value]) as readonly LearningProcessRole[];
}

export function resolveLearningExecution({
  entrypoint = "main",
  environment = process.env,
}: {
  entrypoint?: "main" | "api";
  environment?: Environment;
} = {}): LearningExecution {
  const configured = environment.LMS_PROCESS_ROLES;
  const roles =
    configured === undefined
      ? entrypoint === "main"
        ? LEARNING_PROCESS_ROLES
        : ["api"]
      : configured.split(",").map((role) => role.trim());
  const fileWrites = environment.LMS_FILE_WRITES ?? "local";
  if (fileWrites !== "local" && fileWrites !== "external")
    throw new Error("LMS_FILE_WRITES must be local or external");
  return Object.freeze({
    mode: "api",
    roles: validateLearningRoles(roles, "api"),
    fileWrites,
  });
}

export function resolveLearningWorkerOptions({
  args = process.argv.slice(2),
  environment = process.env,
}: {
  args?: readonly string[];
  environment?: Environment;
} = {}): LearningWorkerOptions {
  const options = new Map<string, string>();
  let healthCheck = false;
  for (const argument of args) {
    if (argument === "--healthcheck") {
      if (healthCheck) throw new Error("Duplicate LMS worker healthcheck flag");
      healthCheck = true;
      continue;
    }
    const match = argument.match(/^--(roles|pool-max|health-file)=(.+)$/);
    if (!match || options.has(match[1]))
      throw new Error("Invalid or duplicate LMS worker option");
    options.set(match[1], match[2]);
  }
  const roleValue = options.get("roles") ?? environment.LMS_PROCESS_ROLES;
  if (roleValue === undefined && !healthCheck)
    throw new Error("LMS worker startup requires explicit process roles");
  const roles =
    roleValue === undefined
      ? []
      : validateLearningRoles(
          roleValue.split(",").map((role) => role.trim()),
          "worker",
        );
  const minimum = Math.max(2, minimumLearningPoolSize(roles));
  const poolValue =
    options.get("pool-max") ??
    environment.LMS_WORKER_POOL_MAX ??
    String(minimum);
  if (!/^(?:[1-9]|10)$/.test(poolValue))
    throw new Error("LMS worker pool max must be an integer from 1 to 10");
  if (!healthCheck && Number(poolValue) < minimum)
    throw new Error(
      `LMS worker roles require at least ${minimum} business connections`,
    );
  const healthFile =
    options.get("health-file") ??
    environment.LMS_WORKER_HEALTH_FILE ??
    "/tmp/academy-lms-worker-health.json";
  if (!path.isAbsolute(healthFile) || healthFile.includes("\0"))
    throw new Error("LMS worker health file must be an absolute path");
  return Object.freeze({
    mode: "worker",
    roles,
    poolMax: Number(poolValue),
    healthFile,
    healthCheck,
  });
}

export function resolveLearningApiOptions({
  args = process.argv.slice(2),
  environment = process.env,
}: {
  args?: readonly string[];
  environment?: Environment;
} = {}): LearningApiOptions {
  const options = new Map<string, string>();
  for (const argument of args) {
    const match = argument.match(/^--(roles|scope|pool-max)=(.+)$/);
    if (!match || options.has(match[1]))
      throw new Error("Invalid or duplicate LMS API option");
    options.set(match[1], match[2]);
  }
  const scope = options.get("scope") ?? environment.LMS_API_SCOPE ?? "all";
  if (scope !== "all" && scope !== "reports" && scope !== "files")
    throw new Error("LMS API scope must be all, reports or files");
  const execution = resolveLearningExecution({
    entrypoint: "api",
    environment: {
      ...environment,
      LMS_PROCESS_ROLES: options.get("roles") ?? environment.LMS_PROCESS_ROLES,
    },
  });
  if (scope !== "all" && execution.roles.length !== 1)
    throw new Error("Scoped LMS APIs must use only the api process role");
  if (scope === "files" && execution.fileWrites === "external")
    throw new Error("LMS files API must own local file writes");
  const poolValue =
    options.get("pool-max") ?? environment.LMS_API_POOL_MAX ?? "10";
  if (!/^(?:[1-9]|10)$/.test(poolValue))
    throw new Error("LMS API pool max must be an integer from 1 to 10");
  const minimum = minimumLearningPoolSize(execution.roles);
  if (Number(poolValue) < minimum)
    throw new Error(
      `LMS API roles require at least ${minimum} business connections`,
    );
  return Object.freeze({ ...execution, scope, poolMax: Number(poolValue) });
}

export const isPhysicalLearningFileWrite = (method: string, path: string) =>
  (method === "PATCH" && /^\/api\/portal\/me\/?$/i.test(path)) ||
  (method === "POST" &&
    /^\/api\/(?:portal\/files|lms-management\/(?:files|assignments))\/?$/i.test(
      path,
    ));

export const learningApiScopeGuard =
  (
    scope: LearningApiScope,
    options: Pick<LearningExecution, "fileWrites"> = {},
  ): RequestHandler =>
  (request, response, next) => {
    const path = request.path;
    if (
      ["/health/live", "/health/ready"].includes(path) &&
      ["GET", "HEAD"].includes(request.method)
    )
      return next();
    if (
      options.fileWrites === "external" &&
      isPhysicalLearningFileWrite(request.method, path)
    )
      return response.status(503).json({ code: "portalUnavailable" });
    if (scope === "reports") {
      if (
        (["GET", "HEAD"].includes(request.method) &&
          /^\/api\/lms-management\/(?:analytics|results|reports)\/?$/.test(
            path,
          )) ||
        (request.method === "POST" &&
          /^\/api\/lms-management\/reports\/?$/.test(path))
      )
        return next();
    } else if (scope === "files") {
      if (isPhysicalLearningFileWrite(request.method, path)) return next();
    } else if (
      /^\/api\/(?:portal|lms-management|public\/portfolio)(?:\/|$)/.test(
        path,
      ) ||
      /^\/api\/academy\/students\/[1-9]\d*\/portal-access(?:\/|$)/.test(path) ||
      /^\/(?:learn|portfolio\/p|assets)(?:\/|$)/.test(path)
    )
      return next();
    response.status(404).json({ code: "portalNotFound" });
  };
