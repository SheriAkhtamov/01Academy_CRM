import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  isPhysicalLearningFileWrite,
  learningApiScopeGuard,
  resolveLearningApiOptions,
  resolveLearningWorkerOptions,
} from "../server/infrastructure/learning-execution";

type Mount = {
  type: string;
  source?: string;
  target: string;
  read_only?: boolean;
  bind?: { create_host_path: boolean };
};
type Service = {
  image: string;
  command?: string[];
  profiles: string[];
  networks: string[] | Record<string, unknown>;
  environment?: Record<string, string>;
  volumes?: (Mount | string)[];
  ports?: string[];
  container_name?: string;
  deploy?: { replicas: number };
  stop_grace_period?: string;
  read_only?: boolean;
  cap_drop?: string[];
  healthcheck: { test?: string[]; disable?: boolean };
};
type Compose = {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean; external?: boolean }>;
  volumes?: Record<string, { external?: boolean }>;
};
const yaml = createRequire(import.meta.url)("js-yaml") as {
  load(source: string): unknown;
};
const read = (name: string) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const compose = yaml.load(read("ops/lms-scale.compose.yml")) as Compose;
const crmOverlay = yaml.load(read("ops/lms-scale.crm.compose.yml")) as Compose;
const proxy = read("ops/lms-scale.haproxy.cfg");
const networks = (service: Service) =>
  Array.isArray(service.networks)
    ? service.networks
    : Object.keys(service.networks);
const mounts = (service: Service) =>
  (service.volumes ?? []).filter(
    (mount): mount is Mount => typeof mount !== "string",
  );
const cli = (service: Service) => service.command?.slice(2) ?? [];

describe("opt-in LMS component deployment", () => {
  it("cannot create another CRM/database or migrate as part of ordinary role startup", () => {
    expect(compose.services.crm).toBeUndefined();
    expect(compose.services.postgres).toBeUndefined();
    expect(compose.networks.database.external).toBe(true);
    expect(compose.networks.crm_edge.external).toBe(true);
    expect(compose.volumes).toBeUndefined();
    for (const [name, service] of Object.entries(compose.services)) {
      expect(service.profiles.length, name).toBeGreaterThan(0);
      expect(service.container_name, name).toBeUndefined();
      if (name === "learning-migrate") continue;
      expect(service.command?.join(" ") ?? "", name).not.toMatch(
        /apply-migrations|\bsh\s+-c/,
      );
    }
    expect(compose.services["learning-migrate"].profiles).toEqual([
      "lms-migrate",
    ]);
    expect(compose.services["learning-migrate"].command).toEqual([
      "node",
      "apply-migrations.js",
    ]);
    expect(crmOverlay.services.crm.command).toEqual(["node", "dist/index.js"]);
    expect(crmOverlay.services.crm.environment).toMatchObject({
      LMS_PROCESS_ROLES: "api",
      LMS_FILE_WRITES: "external",
    });
    expect(crmOverlay.services.crm.ports).toBeUndefined();
    expect(read("docker-compose.yml")).not.toContain("learning-api");
  });

  it("uses the real role parser, sufficient business pools and distinct scoped APIs", () => {
    for (const role of [
      "lifecycle",
      "notifications",
      "files",
      "maintenance",
      "email",
    ]) {
      const service = compose.services[`learning-${role}`];
      const options = resolveLearningWorkerOptions({
        args: cli(service),
        environment: {},
      });
      expect(options.roles).toEqual([role]);
      expect(options.poolMax).toBe(role === "email" ? 3 : 2);
      expect(service.healthcheck.test).toEqual([
        "CMD",
        "node",
        "dist/learning-health.js",
      ]);
      expect(service.stop_grace_period).toBe("90s");
    }
    for (const [name, scope, poolMax] of [
      ["learning-api", "all", 5],
      ["learning-reports", "reports", 2],
      ["learning-upload-api", "files", 5],
    ] as const) {
      const service = compose.services[name];
      expect(
        resolveLearningApiOptions({
          args: cli(service),
          environment: service.environment,
        }),
      ).toMatchObject({
        roles: ["api"],
        scope,
        poolMax,
      });
      expect(service.stop_grace_period).toBe("11m");
      expect(service.ports).toBeUndefined();
    }
    expect(compose.services["learning-upload-api"].deploy?.replicas).toBe(1);
    expect(compose.services["learning-email"].profiles).toEqual(["lms-email"]);
  });

  it("shares the existing uploads without creating replacement folders or replica log races", () => {
    const readers = ["learning-api", "learning-files"];
    const writers = ["learning-upload-api", "learning-maintenance"];
    for (const name of [...readers, ...writers]) {
      const upload = mounts(compose.services[name]).find(
        (mount) => mount.target === "/app/uploads",
      );
      expect(upload?.source).toMatch(/^\$\{LMS_UPLOADS_DIRECTORY:\?/);
      expect(upload?.bind?.create_host_path).toBe(false);
      expect(upload?.read_only === true).toBe(readers.includes(name));
    }
    for (const [name, service] of Object.entries(compose.services)) {
      for (const mount of mounts(service)) {
        if (mount.type === "bind")
          expect(mount.bind?.create_host_path, name).toBe(false);
      }
      if (!service.command?.includes("node")) continue;
      const config = mounts(service).find(
        (mount) => mount.target === "/app/config",
      );
      expect(config?.read_only, name).toBe(true);
      const logs = mounts(service).find(
        (mount) => mount.target === "/app/logs",
      );
      expect(logs, name).toMatchObject({ type: "volume", target: "/app/logs" });
      expect(logs?.source, name).toBeUndefined();
    }
    for (const role of ["reports", "lifecycle", "notifications", "email"])
      expect(
        mounts(compose.services[`learning-${role}`]).some(
          (mount) => mount.target === "/app/uploads",
        ),
      ).toBe(false);
  });

  it("isolates HTTP/email egress, requires no antivirus service and publishes only the private proxy listener", () => {
    expect(compose.networks.http.internal).toBe(true);
    expect(compose.networks.scanner).toBeUndefined();
    expect(compose.networks.signature_egress).toBeUndefined();
    expect(compose.services["learning-clamav"]).toBeUndefined();
    expect(compose.services["learning-clamav-updater"]).toBeUndefined();
    expect(networks(compose.services["learning-files"])).toEqual(["database"]);
    expect(networks(compose.services["learning-upload-api"])).toEqual([
      "http", "database",
    ]);
    expect(networks(compose.services["learning-proxy"])).not.toContain(
      "database",
    );
    expect(networks(compose.services["learning-proxy"])).not.toContain(
      "scanner",
    );
    expect(networks(compose.services["learning-email"])).toContain(
      "email_egress",
    );
    for (const [name, service] of Object.entries(compose.services)) {
      expect(service.read_only, name).toBe(true);
      expect(service.cap_drop, name).toContain("ALL");
      if (name !== "learning-proxy")
        expect(service.ports, name).toBeUndefined();
    }
    expect(compose.services["learning-proxy"].ports).toEqual([
      "127.0.0.1:${LMS_PROXY_HOST_PORT:-8012}:8080",
    ]);
  });

  it("accounts for core/LMS, writer, worker and lease pools before adding replicas", () => {
    const pool = (name: string) =>
      Number(
        cli(compose.services[name])
          .find((arg) => arg.startsWith("--pool-max="))
          ?.split("=")[1],
      );
    const workers = [
      "lifecycle",
      "notifications",
      "files",
      "maintenance",
    ].reduce((sum, role) => sum + pool(`learning-${role}`), 0);
    const base =
      30 +
      pool("learning-api") * 2 +
      pool("learning-reports") * 2 +
      pool("learning-upload-api") * 2 +
      workers +
      2;
    const reserve = 1 + 1 + 16;
    expect(base).toBe(64);
    expect(base + pool("learning-email") + reserve).toBe(85);
    expect(
      base + pool("learning-email") + reserve + pool("learning-api") * 2,
    ).toBeLessThan(100);
    expect(base + reserve + pool("learning-api") * 4).toBeGreaterThan(100);
  });
});

function pathAcl(name: string, path: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = proxy.match(
    new RegExp(`^\\s*acl ${escapedName} path_reg (?:(-i) )?(.+)$`, "m"),
  );
  if (!match) throw new Error(`Missing path ACL: ${name}`);
  return new RegExp(match[2], match[1] ? "i" : "").test(path);
}
function backendFor(method: string, path: string) {
  const acl: Record<string, boolean> = {
    file_write: pathAcl("file_write", path),
    post: method === "POST",
    reports_path: pathAcl("reports_path", path),
    reports_read: method === "GET" || method === "HEAD",
    reports_create: pathAcl("reports_create", path),
    learner_path: pathAcl("learner_path", path),
    learning_api: pathAcl("learning_api", path),
    access_api: pathAcl("access_api", path),
  };
  for (const line of proxy.matchAll(/^\s*use_backend (\S+) if (.+)$/gm))
    if (
      line[2]
        .trim()
        .split(/\s+/)
        .every((name) => acl[name])
    )
      return line[1];
  return "crm";
}

describe("proxy routing and runtime boundaries", () => {
  it("routes every physical write to the singleton and rejects replica bypass before handlers", async () => {
    const all = express()
      .use(learningApiScopeGuard("all", { fileWrites: "external" }))
      .use((_req, res) => res.sendStatus(204));
    const files = express()
      .use(learningApiScopeGuard("files"))
      .use((_req, res) => res.sendStatus(204));
    for (const path of [
      "/api/portal/files",
      "/api/lms-management/files",
      "/api/lms-management/assignments",
      "/API/PORTAL/FILES/",
    ]) {
      expect(isPhysicalLearningFileWrite("POST", path)).toBe(true);
      expect(backendFor("POST", path)).toBe("uploads");
      expect((await request(all).post(path)).status).toBe(503);
      expect((await request(files).post(path)).status).toBe(204);
    }
    expect(backendFor("GET", "/api/portal/files/12")).toBe("learning");
    expect((await request(files).get("/api/portal/me")).status).toBe(404);
    expect((await request(files).get("/api/portal/ws")).status).toBe(404);
    expect(proxy).toContain("server writer learning-upload-api:5001");
    expect(proxy).not.toMatch(
      /server-template\s+\S+\s+\S+\s+learning-upload-api/,
    );
  });

  it("matches report guard routes with methods while retaining ordinary mutation routing", async () => {
    const app = express()
      .use(learningApiScopeGuard("reports"))
      .use((_req, res) => res.sendStatus(204));
    for (const path of [
      "/api/lms-management/analytics",
      "/api/lms-management/results",
      "/api/lms-management/reports/",
    ]) {
      expect(backendFor("GET", path)).toBe("reports");
      expect((await request(app).get(path)).status).toBe(204);
    }
    expect(backendFor("POST", "/api/lms-management/reports")).toBe("reports");
    expect(
      (await request(app).post("/api/lms-management/reports")).status,
    ).toBe(204);
    expect(backendFor("POST", "/api/lms-management/results")).toBe("learning");
    expect(
      (await request(app).post("/api/lms-management/results")).status,
    ).toBe(404);
    expect(
      (await request(app).get("/api/academy/students/4/portal-access")).status,
    ).toBe(404);
  });

  it("keeps learner WebSockets, private links, exact access prefixes and staff routes in their intended processes", () => {
    for (const path of [
      "/learn",
      "/learn/assignments",
      "/portfolio/p/private-token",
      "/api/portal/ws",
      "/api/public/portfolio/private-token",
      "/api/academy/students/4/portal-access",
    ])
      expect(backendFor("GET", path)).toBe("learning");
    for (const path of [
      "/api/auth/session",
      "/api/academy/students",
      "/assets/index.js",
      "/learners",
      "/portfolio/public",
      "/api/academy/students/4/portal-accessory",
      "/api/academy/students/0/portal-access",
    ])
      expect(backendFor("GET", path)).toBe("crm");
    expect(proxy).toContain("timeout tunnel 1h");
    expect(proxy).toContain("timeout http-request 15s");
    expect(proxy).toContain("timeout client 10m");
    expect(proxy).toContain("timeout server 10m");
    expect(proxy).not.toContain("option http-buffer-request");
    expect(proxy).not.toMatch(
      /(?:set-path|replace-path|set-uri|del-header\s+(?:Origin|Cookie|Upgrade|X-Portal-CSRF))/i,
    );
    expect(proxy.match(/^\s*log-format.*$/m)?.[0]).not.toMatch(
      /%r|%HU|capture|hdr\(/,
    );
    expect(proxy).toContain("resolvers docker");
    expect(proxy).toContain("server-template api 1-16 learning-api:5001");
  });
});
