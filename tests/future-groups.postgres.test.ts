import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ActorContext } from "../server/modules/leads/domain/actor-context";
import { futureGroupPartySchema, type FutureGroupInput } from "../shared/contracts/future-groups";

const fixture = vi.hoisted(() => ({
  pool: null as Pool | null,
  context: null as AsyncLocalStorage<PoolClient> | null,
}));
vi.mock("../server/modules/academy/academy-core", () => {
  const camel = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        v,
      ]),
    );
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await (fixture.context!.getStore() ?? fixture.pool!).query(
      sql,
      values,
    );
    return result.rows.map(camel);
  };
  const columns = (values: Record<string, unknown>) =>
    Object.keys(values).map(
      (k) => '"' + k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()) + '"',
    );
  const values = (row: Record<string, unknown>) =>
    Object.values(row).map((v) => (Array.isArray(v) ? JSON.stringify(v) : v));
  return {
    query,
    queryOne: async (sql: string, values: unknown[] = []) =>
      (await query(sql, values))[0],
    withTransaction: async <T>(fn: () => Promise<T>) => {
      if (fixture.context!.getStore()) return fn();
      const client = await fixture.pool!.connect();
      try {
        return await fixture.context!.run(client, async () => {
          await client.query("BEGIN");
          try {
            const result = await fn();
            await client.query("COMMIT");
            return result;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
        });
      } finally {
        client.release();
      }
    },
    insertRow: async (table: string, row: Record<string, unknown>) =>
      (
        await query(
          `INSERT INTO ${table}(${columns(row)}) VALUES(${Object.keys(row).map((_, i) => "$" + (i + 1))}) RETURNING *`,
          values(row),
        )
      )[0],
    updateRow: async (
      table: string,
      id: number,
      row: Record<string, unknown>,
    ) =>
      (
        await query(
          `UPDATE ${table} SET ${columns(row)
            .map((k, i) => `${k}=$${i + 1}`)
            .join(
              ",",
            )},updated_at=clock_timestamp() WHERE id=$${Object.keys(row).length + 1} RETURNING *`,
          [...values(row), id],
        )
      )[0],
    createAudit: vi.fn().mockResolvedValue(undefined),
    canAccessLeadRow: (actor: ActorContext, row: Record<string, unknown>) =>
      actor.isLeadership || actor.userId === row.managerId,
    canMutateLeadRow: (actor: ActorContext, row: Record<string, unknown>) =>
      actor.isLeadership || actor.userId === row.managerId,
  };
});
vi.mock("../server/modules/academy/group-code", () => ({
  allocateGroupName: async (values: Record<string, unknown>) => {
    values.name = "CYP-AI-GRP-26-0001";
  },
  preserveGroupCode: (
    _old: unknown,
    values: Record<string, unknown>,
    input: FutureGroupInput,
  ) => {
    values.name =
      "CYP-AI-GRP-26-0001" + (input.nameSuffix ? " — " + input.nameSuffix : "");
  },
}));
vi.mock("../server/modules/academy/group-teacher-eligibility", () => ({
  listEligibleGroupTeachers: async () => [{ id: 1 }],
}));
import { FutureGroupsRepository } from "../server/modules/future-groups/infrastructure/repository";
import { startWaitingGroupStudents } from "../server/modules/future-groups/infrastructure/student-start";

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = "future_" + randomUUID().replace(/-/g, "");
const actor: ActorContext = {
  userId: 1,
  primaryModule: "sales",
  modules: ["sales"],
  isLeadership: false,
};
const input: FutureGroupInput = {
  nameSuffix: "",
  courseId: 1,
  schoolId: 1,
  deliveryMode: "offline",
  maxStudents: 1,
  startDate: null,
  teacherId: null,
  roomId: null,
  lessonDurationMinutes: 120,
  schedule: [],
};
const repository = new FutureGroupsRepository();

describe.skipIf(!url)("Future groups persistence", () => {
  let admin: Pool;
  beforeAll(async () => {
    if (
      !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(
        url!,
      )
    )
      throw Error("Isolated local PostgreSQL required");
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.context = new AsyncLocalStorage();
    fixture.pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema} -c timezone=UTC`,
    });
    await fixture.pool.query(`
      CREATE TABLE users(id int PRIMARY KEY,full_name text);
      CREATE TABLE academy_courses(id int PRIMARY KEY,name text,is_active boolean);
      CREATE TABLE academy_schools(id int PRIMARY KEY,name text,is_active boolean);
      CREATE TABLE academy_rooms(id int PRIMARY KEY,school_id int,name text,is_active boolean,capacity int);
      CREATE TABLE academy_teachers(id int PRIMARY KEY,full_name text);
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text,course_id int,school_id int,room_id int NOT NULL,teacher_id int,
        max_students int,status text,start_date timestamp,end_date timestamp,schedule jsonb,lesson_duration_minutes int,lesson_count int,selected_course_lesson_ids jsonb,duration_days int,
        is_archived boolean DEFAULT false,archived_at timestamp,archived_by int,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,course_id int);
      CREATE TABLE academy_leads(id int PRIMARY KEY,manager_id int,funnel_id int,student_name text,contact_name text,phone text,
        is_archived boolean DEFAULT false,enrolled_group_id int,course_id int,school_id int,updated_at timestamp DEFAULT now());
      CREATE TABLE academy_students(id int PRIMARY KEY,lead_id int,group_id int,student_name text,status text,course_id int,school_id int,updated_at timestamp DEFAULT now(),is_archived boolean DEFAULT false);
      CREATE TABLE academy_lead_group_reservations(id serial PRIMARY KEY,group_id int,lead_id int,created_by int,UNIQUE(group_id,lead_id));
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id int,group_id int,status text,is_primary boolean,enrolled_at timestamp,ended_at timestamp,created_by int,updated_at timestamp DEFAULT now());
      CREATE UNIQUE INDEX future_enrollment_active_unique ON academy_student_group_enrollments(student_id,group_id) WHERE status='active';
      CREATE TABLE academy_payments(id serial PRIMARY KEY,group_id int,lead_id int,student_id int,amount_uzs int,status text);
      CREATE TABLE academy_student_status_history(id serial PRIMARY KEY,student_id int,from_status text,to_status text,changed_by int,comment text);
    `);
    // Include the existing curriculum constraint: an empty selection is invalid
    // even for a future group. The old fixture silently omitted this migration.
    await fixture.pool.query(
      readFileSync("migrations/0155_course_curriculum.sql", "utf8"),
    );
    await fixture.pool.query(
      readFileSync("migrations/0169_future_groups.sql", "utf8"),
    );
  });
  beforeEach(async () => {
    await fixture.pool!
      .query(`TRUNCATE academy_groups,academy_leads,academy_students,academy_lead_group_reservations,academy_student_group_enrollments,academy_payments,academy_student_status_history RESTART IDENTITY;
      INSERT INTO users VALUES(1,'Manager'),(2,'Other manager') ON CONFLICT DO NOTHING;
      INSERT INTO academy_courses VALUES(1,'AI Kids',true) ON CONFLICT DO NOTHING;
      INSERT INTO academy_schools VALUES(1,'Cyberpark',true) ON CONFLICT DO NOTHING;
      INSERT INTO academy_rooms VALUES(1,1,'101',true,10) ON CONFLICT DO NOTHING;
      INSERT INTO academy_leads(id,manager_id,funnel_id,contact_name,student_name) VALUES(11,1,1,'Parent A','Child A'),(12,1,1,'Parent B','Child B'),(13,2,1,'Private parent','Private child');`);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  const create = () => repository.save(actor, input);
  it("saves the Sunday group before its curriculum is selected and retains the plan on edit", async () => {
    const plan: FutureGroupInput = {
      ...input,
      nameSuffix: "Группа: Сарвиноз (15:00-17:00) (Дархан)",
      maxStudents: 8,
      startDate: "2026-11-15",
      roomId: 1,
      teacherId: 1,
      schedule: [{ dayOfWeek: 7, startTime: "15:00", endTime: "17:00" }],
    };
    const group = await repository.save(actor, plan);
    expect(group).toMatchObject({ status: "planned", selectedCourseLessonIds: null,
      lessonCount: 0, maxStudents: 8, teacherId: 1, roomId: 1, schedule: plan.schedule });
    expect((await repository.list())[0]).toMatchObject({ id: group.id, startDate: "2026-11-15" });
    const edited = await repository.save(actor, {
      ...plan, maxStudents: 9, expectedUpdatedAt: group.updatedAt.toISOString(),
    }, group.id);
    expect(edited).toMatchObject({ selectedCourseLessonIds: null, maxStudents: 9, schedule: plan.schedule });
    expect((await fixture.pool!.query("SELECT count(*)::int AS count FROM academy_lessons")).rows[0].count).toBe(0);
  });
  it("never plans more places than the room seats, while an online group needs neither room nor branch", async () => {
    await expect(repository.save(actor, { ...input, roomId: 1, maxStudents: 11 }))
      .rejects.toMatchObject({ message: "groupCapacityExceedsRoom", statusCode: 409 });
    expect((await fixture.pool!.query("SELECT count(*)::int AS count FROM academy_groups")).rows[0].count).toBe(0);
    await expect(repository.save(actor, { ...input, roomId: 1, maxStudents: 10 })).resolves.toMatchObject({ maxStudents: 10 });
    // Naming is mocked here; an online group simply keeps no room and needs no branch.
    const online = await repository.save(actor, { ...input, deliveryMode: "online", schoolId: null, roomId: 1, maxStudents: 30 });
    expect(online).toMatchObject({ schoolId: null, roomId: null, maxStudents: 30 });
  });
  it("keeps the curriculum constraint: no empty or non-array selections", async () => {
    const group = await create();
    for (const value of [[], {}, "invalid"]) {
      await expect(fixture.pool!.query(
        "UPDATE academy_groups SET selected_course_lesson_ids=$2::jsonb WHERE id=$1",
        [group.id, JSON.stringify(value)],
      )).rejects.toMatchObject({ code: "23514", constraint: "academy_groups_course_lessons_array" });
    }
    await fixture.pool!.query(
      "UPDATE academy_groups SET selected_course_lesson_ids=$2::jsonb WHERE id=$1",
      [group.id, JSON.stringify(["lesson-1"])],
    );
  });
  it("creates a future group without a date, teacher or room; teaching still requires a room", async () => {
    const group = await create();
    expect(group).toMatchObject({
      status: "planned",
      startDate: null,
      roomId: null,
      teacherId: null,
    });
    await expect(
      fixture.pool!.query(
        "UPDATE academy_groups SET status='in_progress' WHERE id=$1",
        [group.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await repository.list()).toHaveLength(1);
  });
  it("gives the last seat once even when managers submit simultaneously", async () => {
    const group = await create();
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(31,11,NULL,'Pupil A','trial',NULL,NULL,now()),(32,12,NULL,'Pupil B','trial',NULL,NULL,now())",
    );
    const results = await Promise.allSettled(
      [31, 32].map((id) =>
        repository.changeMember(actor, group.id, { kind: "student", id }, false),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await repository.list())[0]).toMatchObject({
      currentStudents: 1,
      reservedStudents: 0,
      paidMembers: 0,
    });
  });
  it("deduplicates a repeated enrollment and frees its place on cancellation", async () => {
    const group = await create();
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(31,11,NULL,'Pupil A','trial',NULL,NULL,now()),(32,12,NULL,'Pupil B','trial',NULL,NULL,now())",
    );
    await Promise.all(
      [1, 2].map(() =>
        repository.changeMember(actor, group.id, { kind: "student", id: 31 }, false),
      ),
    ).catch(() => undefined);
    expect(await repository.members(actor, group.id)).toHaveLength(1);
    await repository.changeMember(actor, group.id, { kind: "student", id: 31 }, true);
    await repository.changeMember(actor, group.id, { kind: "student", id: 32 }, false);
    expect((await repository.members(actor, group.id))[0].id).toBe(32);
  });
  it("counts siblings separately and preserves the parent ownership boundary", async () => {
    const group = await repository.save(actor, { ...input, maxStudents: 2 });
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(21,11,NULL,'First child','trial',NULL,NULL,now()),(22,11,NULL,'Second child','trial',NULL,NULL,now())",
    );
    for (const id of [21, 22])
      await repository.changeMember(
        actor,
        group.id,
        { kind: "student", id },
        false,
      );
    expect((await repository.list())[0]).toMatchObject({
      currentStudents: 2,
      reservedStudents: 0,
    });
    expect(await repository.members(actor, group.id)).toHaveLength(2);
    await expect(
      repository.changeMember(
        { ...actor, userId: 2 },
        group.id,
        { kind: "student", id: 21 },
        true,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await repository.members({ ...actor, userId: 2 }, group.id),
    ).toHaveLength(0);
  });
  it("rejects a stale edit and a capacity below current enrollments", async () => {
    const group = await repository.save(actor, { ...input, maxStudents: 2 });
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(31,11,NULL,'Pupil A','trial',NULL,NULL,now()),(32,12,NULL,'Pupil B','trial',NULL,NULL,now())",
    );
    for (const id of [31, 32])
      await repository.changeMember(actor, group.id, { kind: "student", id }, false);
    await expect(
      repository.save(
        actor,
        {
          ...input,
          expectedUpdatedAt: new Date(group.updatedAt).toISOString(),
        },
        group.id,
      ),
    ).rejects.toThrow("groupCapacityBelowOccupancy");
    await expect(
      repository.save(
        actor,
        {
          ...input,
          maxStudents: 2,
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        },
        group.id,
      ),
    ).rejects.toThrow("futureGroupChanged");
  });
  it("shows paid money for the selected group and excludes refunded payments", async () => {
    const group = await create();
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(31,11,NULL,'Pupil A','trial',NULL,NULL,now()),(32,12,NULL,'Pupil B','trial',NULL,NULL,now())",
    );
    await repository.changeMember(actor, group.id, { kind: "student", id: 31 }, false);
    await fixture.pool!.query(
      "INSERT INTO academy_payments(group_id,lead_id,student_id,amount_uzs,status) VALUES($1,11,31,100000,'paid'),($1,11,31,50000,'refunded'),(999,11,31,900000,'paid')",
      [group.id],
    );
    expect((await repository.members(actor, group.id))[0].paidAmountUzs).toBe(100000);
    expect((await repository.list())[0]).toMatchObject({ paidMembers: 1, paidAmountUzs: 100000 });
    await repository.changeMember(actor, group.id, { kind: "student", id: 31 }, true);
    expect((await repository.list())[0]).toMatchObject({ paidMembers: 0, paidAmountUzs: 100000 });
  });

  it("accepts only pupils created inside a lead, never the lead itself", () => {
    expect(futureGroupPartySchema.safeParse({ kind: "lead", id: 11 }).success).toBe(false);
    expect(futureGroupPartySchema.safeParse({ kind: "student", id: 31 }).success).toBe(true);
  });
  it("starts waiting students only after the group is actually launched", async () => {
    const group = await create();
    await fixture.pool!.query(
      "INSERT INTO academy_students VALUES(21,11,NULL,'Child','trial',NULL,NULL,now())",
    );
    await repository.changeMember(
      actor,
      group.id,
      { kind: "student", id: 21 },
      false,
    );
    await startWaitingGroupStudents(group.id, 1);
    expect(
      (
        await fixture.pool!.query(
          "SELECT status FROM academy_students WHERE id=21",
        )
      ).rows[0].status,
    ).toBe("waiting_start");
    await fixture.pool!.query(
      "UPDATE academy_groups SET room_id=1,status='in_progress' WHERE id=$1",
      [group.id],
    );
    await startWaitingGroupStudents(group.id, 1);
    await startWaitingGroupStudents(group.id, 1);
    expect(
      (
        await fixture.pool!.query(
          "SELECT status FROM academy_students WHERE id=21",
        )
      ).rows[0].status,
    ).toBe("studying");
    expect(
      (
        await fixture.pool!.query(
          "SELECT * FROM academy_student_status_history WHERE to_status='studying'",
        )
      ).rows,
    ).toHaveLength(1);
  });
});
