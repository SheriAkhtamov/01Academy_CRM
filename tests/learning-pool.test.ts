import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/config";
const mocks = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }));
vi.mock("pg", () => ({
  Pool: function Pool(config: unknown) {
    return mocks.create(config);
  },
}));
vi.mock("../server/lib/logger", () => ({ logger: { error: mocks.error } }));
import {
  createLearningPool,
  prepareLearningReads,
} from "../server/infrastructure/learning-pool";
import { createLearningExecutionPools } from "../server/infrastructure/learning-execution-pools";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import { LearningFeatureController } from "../server/infrastructure/learning-flags";
import { portalInvitationCreateSchema } from "@shared/contracts/portal-identity";
const sql =
  "SELECT id FROM fixture WHERE active=$1 /*" +
  " scoped query ".repeat(25) +
  "*/";
const config = (enabled = true): AppConfig =>
  ({
    database: {
      url: "postgresql://fixture.invalid/test",
      ssl: false,
      pool: { max: 20 },
    },
    portal: { enabled },
  }) as AppConfig;
const fake = () => ({
  query: vi.fn(async (..._args: unknown[]) => ({ rows: [] })),
  end: vi.fn(async () => undefined),
  on: vi.fn(),
  connect: vi.fn(),
});
beforeEach(() => {
  mocks.create.mockReset();
  mocks.error.mockReset();
});
describe("Learning connection budget and prepared plans", () => {
  it("owns separate bounded worker business/lease pools and never closes the staff pool", async () => {
    const staff = fake(),
      business = fake(),
      lease = fake();
    mocks.create.mockReturnValueOnce(business).mockReturnValueOnce(lease);
    const owned = createLearningExecutionPools(
      staff as unknown as Pool,
      config(),
      { mode: "worker", roles: ["lifecycle"] },
      { max: 2, applicationName: "academy_lms_worker" },
    );
    expect(
      mocks.create.mock.calls.map(([input]) => [
        input.max,
        input.application_name,
      ]),
    ).toEqual([
      [2, "academy_lms_worker"],
      [1, "academy_lms_leases"],
    ]);
    await Promise.all([owned.close(), owned.close()]);
    expect(business.end).toHaveBeenCalledTimes(1);
    expect(lease.end).toHaveBeenCalledTimes(1);
    expect(staff.end).not.toHaveBeenCalled();
  });
  it("creates no lease pool for API-only processes and refuses undersized workers before creating a pool", async () => {
    mocks.create.mockReturnValue(fake());
    const owned = createLearningExecutionPools(
      null,
      config(),
      { mode: "api", roles: ["api"] },
      { max: 5 },
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await owned.close();
    mocks.create.mockClear();
    expect(() =>
      createLearningExecutionPools(
        null,
        config(),
        { mode: "worker", roles: ["credentials"] },
        { max: 1 },
      ),
    ).toThrow();
    const capped = config();
    capped.database.pool = { max: 1 };
    expect(() =>
      createLearningExecutionPools(
        null,
        capped,
        { mode: "worker", roles: ["credentials"] },
        { max: 3 },
      ),
    ).toThrow("at least 2");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(() => createLearningPool(null, config(false))).toThrow();
    expect(() => createLearningPool(null, config(), { max: 11 })).toThrow();
  });
  it("rejects a configured one-connection API cap before constructing an LMS database pool", () => {
    const capped = config();
    capped.database.pool = { max: 1 };
    expect(() =>
      createLearningExecutionPools(
        null,
        capped,
        { mode: "api", roles: ["api"] },
        { max: 5 },
      ),
    ).toThrow("at least 2 business connections");
    expect(() =>
      createLearningExecutionPools(
        null,
        config(),
        { mode: "api", roles: ["api"] },
        { max: 1 },
      ),
    ).toThrow("at least 2 business connections");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("runs a group invitation ACL callback while the real identity repository holds its transaction client", async () => {
    let active = 0,
      maximum = 0;
    const acquire = () => {
      if (active >= 2) throw new Error("No spare business connection");
      active++;
      maximum = Math.max(maximum, active);
    };
    const membership = vi.fn(() => {
      expect(active).toBe(2);
      return { rows: [{ allowed: false }] };
    });
    const client = {
      query: vi.fn(async (sql: string) =>
        sql.includes("FROM academy_students student")
          ? { rows: [{ id: 1, manager_id: 1, classification: "adult" }] }
          : { rows: [] },
      ),
      release: vi.fn(() => {
        active--;
      }),
    };
    const business = {
      ...fake(),
      connect: vi.fn(async () => {
        acquire();
        return client;
      }),
      query: vi.fn(async (input: string | { text: string }) => {
        acquire();
        try {
          const sql = typeof input === "string" ? input : input.text;
          if (sql.includes("FROM lms_feature_flags"))
            return {
              rows: [
                {
                  key: "invitations",
                  enabled: true,
                  all_groups: false,
                  group_ids: [1],
                  updated_at: new Date(),
                  version: 1,
                },
              ],
            };
          if (sql.includes("FROM academy_student_group_enrollments"))
            return membership();
          return { rows: [] };
        } finally {
          active--;
        }
      }),
    };
    mocks.create.mockReturnValue(business);
    const configuration = config();
    configuration.portal!.allowInvitations = true;
    const owned = createLearningExecutionPools(
      null,
      configuration,
      { mode: "api", roles: ["api"] },
      { max: 2 },
    );
    const flags = new LearningFeatureController(owned.pool, configuration);
    await flags.refresh();
    const identity = new PortalIdentityService(
      createPostgresPortalRepository(owned.pool),
      createPortalCrypto(),
      {
        appUrl: "https://portal.example.test",
        allowInvitations: true,
        invitationsEnabledForStudent: (id) =>
          flags.enabledForStudent("invitations", id),
      },
    );
    try {
      await expect(
        identity.createInvitation(
          { staffId: 1, modules: ["sales"], canManageAccess: true },
          1,
          portalInvitationCreateSchema.parse({
            account: { login: "fixture.learner", fullName: "Fixture Learner" },
            kind: "self",
            permissions: [],
            verificationMethod: "in_person",
            verificationBasis: "Verified with recipient",
            channel: "manual",
            idempotencyKey: "4f225cbf-e9fb-4246-88ad-908b509fa8e7",
          }),
        ),
      ).rejects.toMatchObject({ code: "portalInvitationsDisabled" });
      expect(membership).toHaveBeenCalledTimes(1);
      expect(maximum).toBe(2);
      expect(active).toBe(0);
      expect(client.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
      expect(client.release).toHaveBeenCalledTimes(1);
    } finally {
      await owned.close();
    }
  });
  it("creates no pool or staff mutation while disabled", async () => {
    const staff = fake(),
      original = staff.query;
    const runtime = createLearningPool(staff as unknown as Pool, config(false));
    expect(runtime.pool).toBe(staff);
    expect(staff.query).toBe(original);
    await runtime.close();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(staff.end).not.toHaveBeenCalled();
  });
  it("owns at most ten connections independently and closes only its own pool once", async () => {
    const staff = fake(),
      owned = fake();
    mocks.create.mockReturnValue(owned);
    const runtime = createLearningPool(staff as unknown as Pool, config());
    expect(runtime.pool).toBe(owned);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 10,
        application_name: "academy_lms",
        connectionString: config().database.url,
      }),
    );
    expect(mocks.create.mock.calls[0][0].options).not.toMatch(/collapse|geqo/);
    await Promise.all([runtime.close(), runtime.close()]);
    expect(owned.end).toHaveBeenCalledTimes(1);
    expect(staff.end).not.toHaveBeenCalled();
    const small = config();
    small.database.pool = { max: 3 };
    createLearningPool(staff as unknown as Pool, small);
    expect(mocks.create.mock.calls[1][0].max).toBe(3);
  });
  it("reuses only a SQL plan name while executing each call with its current values", async () => {
    const native = fake(),
      query = native.query;
    const pool = prepareLearningReads(native as unknown as Pool);
    await pool.query(sql, [true]);
    await pool.query(sql, [false]);
    await pool.query(sql + " ", [true]);
    expect(query).toHaveBeenCalledTimes(3);
    const first = query.mock.calls[0][0] as unknown as {
      name: string;
      text: string;
      values: unknown[];
    };
    const second = query.mock.calls[1][0] as unknown as typeof first;
    const third = query.mock.calls[2][0] as unknown as typeof first;
    expect(Buffer.byteLength(first.name, "utf8")).toBeLessThanOrEqual(63);
    expect(first.text).toBe(sql);
    expect(first.name).toBe(second.name);
    expect(first.values).toEqual([true]);
    expect(second.values).toEqual([false]);
    expect(third.name).not.toBe(first.name);
  });
  it("bounds prepared shapes and preserves native query forms and transaction connections", async () => {
    const native = fake(),
      query = native.query,
      connect = native.connect;
    const pool = prepareLearningReads(native as unknown as Pool);
    for (let i = 0; i < 129; i++) await pool.query(sql + ` /*${i}*/`, [true]);
    expect(query.mock.calls[127][0]).toEqual(
      expect.objectContaining({ name: expect.any(String) }),
    );
    expect(query.mock.calls[128][0]).toBe(sql + " /*128*/");
    await pool.query(sql + " /*0*/", [false]);
    expect(query.mock.calls[129][0]).toEqual(
      expect.objectContaining({ name: expect.any(String), values: [false] }),
    );
    await pool.query("UPDATE fixture SET active=$1", [false]);
    expect(query.mock.calls[130]).toEqual([
      "UPDATE fixture SET active=$1",
      [false],
    ]);
    const nativeInput = { text: sql, values: [true] };
    await pool.query(nativeInput);
    expect(query.mock.calls[131][0]).toBe(nativeInput);
    expect(pool.connect).toBe(connect);
  });
});
