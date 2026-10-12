import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { getTableName, SQL } from "drizzle-orm";
import { pgTable, serial, getTableConfig, PgDialect, type PgTable, type AnyPgColumn } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLearningTables, createLearningPortfolioColumns, createLearningPortfolioConstraints } from "../server/db/schema/learning";
import { createPortalCredentialTables } from "../server/db/schema/portal-credentials";
import * as deployedSchema from "../server/db/schema";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_schema_it_${randomBytes(8).toString("hex")}`;
let admin: Pool, pool: Pool;
const users = pgTable("users", { id: serial("id").primaryKey() });
const students = pgTable("academy_students", { id: serial("id").primaryKey() });
const courses = pgTable("academy_courses", { id: serial("id").primaryKey() });
const groups = pgTable("academy_groups", { id: serial("id").primaryKey() });
const lessons = pgTable("academy_lessons", { id: serial("id").primaryKey() });
const enrollments = pgTable("academy_student_group_enrollments", { id: serial("id").primaryKey() });
const payments = pgTable("academy_payments", { id: serial("id").primaryKey() });
const projects = pgTable("academy_portfolio_projects", { id: serial("id").primaryKey(), ...createLearningPortfolioColumns() }, (table) => createLearningPortfolioConstraints(table, { runId: () => tables.lmsGroupRuns.id, submissionId: () => tables.lmsSubmissions.id, fileId: () => tables.lmsFiles.id, userId: () => users.id }));
const tables = createLearningTables({ userId: users.id, studentId: students.id, courseId: courses.id, groupId: groups.id, lessonId: lessons.id, enrollmentId: enrollments.id, projectId: projects.id, paymentId: payments.id });
const leads = pgTable("academy_leads", { id: serial("id").primaryKey() });
const credentials = createPortalCredentialTables({ accountId: tables.portalAccounts.id, leadId: leads.id, studentId: students.id, userId: users.id });
const configurations = [...Object.values(tables), ...Object.values(credentials)].map(getTableConfig);
const dialect = new PgDialect();
const expression = (value: SQL | undefined) => value ? dialect.sqlToQuery(value).sql : null;
const names = (columns: AnyPgColumn[]) => columns.map((column) => column.name);
const sorted = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const normalizeType = (value: string) => value.replace(/^bigserial$/, "bigint").replace(/^serial$/, "integer").replace(/^varchar\(/, "character varying(").replace(/^time$/, "time without time zone");
const normalizeExpression = (value: string | null) => value?.replace(/"academy_portfolio_projects"\./g, "").replace(/"([^"']+)"/g, "$1").replace(/\s+/g, "") ?? null;
function defaultValue(value: unknown, type: string): unknown {
  if (value instanceof SQL) value = expression(value);
  if (typeof value !== "string") return value;
  if (value === "true" || value === "false") return value === "true";
  if (/^-?\d+$/.test(value) && ["integer", "bigint"].includes(type)) return Number(value);
  if (value === "'{}'::integer[]") return [];
  const json = /^'((?:[^']|'')*)'::jsonb$/.exec(value);
  if (type === "jsonb" && json) return JSON.parse(json[1].replace(/''/g, "'"));
  const literal = /^'((?:[^']|'')*)'::(?:text|character varying)$/.exec(value);
  return literal ? literal[1].replace(/''/g, "'") : value;
}

describe("Server-only learning schema initialization", () => {
  it("resolves all 62 table families without schema import cycles and models null-equal comparison scope", () => {
    expect(configurations).toHaveLength(62);
    expect(new Set(configurations.map((table) => table.name)).size).toBe(62);
    const comparison = getTableConfig(tables.lmsProjectComparisons);
    expect(comparison.uniqueConstraints.some((unique) => unique.nullsNotDistinct && names(unique.columns).join(",") === "student_id,run_id")).toBe(true);
    expect(getTableConfig(projects).foreignKeys).toHaveLength(4);
    for (const config of configurations) for (const foreign of config.foreignKeys) expect(foreign.reference().foreignColumns.length).toBe(foreign.reference().columns.length);
  });
  it("exports every learning table from the configured schema entrypoint and keeps portal fields out of legacy insert commands", () => {
    const exports = deployedSchema as Record<string, unknown>;
    for (const config of configurations) {
      const key = config.name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      expect(getTableConfig(exports[key] as PgTable).columns.map((column) => column.name), key).toEqual(config.columns.map((column) => column.name));
    }
    const project = deployedSchema.insertAcademyPortfolioProjectSchema.parse({ studentId: 1, title: "Project", lmsRunId: 99, coverFileId: 88, portalVersion: 9, portalCreated: true, reviewedBy: 7 });
    expect(project).not.toHaveProperty("lmsRunId"); expect(project).not.toHaveProperty("coverFileId");
    expect(project).not.toHaveProperty("portalVersion"); expect(project).not.toHaveProperty("reviewedBy");
    expect(project).not.toHaveProperty("portalCreated");
    const payment = deployedSchema.insertAcademyPaymentSchema.parse({ amountUzs: 1000, allocationVersion: 99 });
    expect(payment).not.toHaveProperty("allocationVersion");
    expect(deployedSchema.academyPayments.allocationVersion.notNull).toBe(true);
    expect(deployedSchema.academyPayments.allocationVersion.default).toBe(0);
  });
});

describe.skipIf(!databaseUrl)("Learning Drizzle declarations match actual 0134–0137 migrations", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Schema parity tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_leads(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY); CREATE TABLE academy_courses(id serial PRIMARY KEY); CREATE TABLE academy_groups(id serial PRIMARY KEY,course_id integer); CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer); CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,enrolled_at timestamptz,ended_at timestamptz); CREATE TABLE academy_payments(id serial PRIMARY KEY,amount_uzs integer); CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY);`);
    for (const migration of ["0134_portal_identity", "0135_lms_learning", "0136_portal_resources", "0137_lms_crm_preparation", "0138_manual_portal_credentials", "0139_fixed_learning_policy"]) await pool.query(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), "utf8"));
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  const all = () => [...configurations, getTableConfig(projects)];
  it("covers every new SQL table and all columns, types, nullability and non-sequence defaults", async () => {
    const sqlNames = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND (tablename LIKE 'lms_%' OR tablename LIKE 'portal_%' OR tablename='academy_payment_student_allocations') ORDER BY tablename", [schema])).rows.map((row) => row.tablename);
    expect(configurations.map((table) => table.name).sort()).toEqual(sqlNames);
    for (const config of all()) {
      const columns = (await pool.query<{ name: string; type: string; not_null: boolean; default: string | null }>(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, config.name])).rows;
      expect(config.columns.map((column) => column.name), config.name).toEqual(columns.map((column) => column.name));
      for (const column of config.columns) {
        const actual = columns.find((value) => value.name === column.name)!;
        expect(normalizeType(column.getSQLType()), `${config.name}.${column.name} type`).toBe(actual.type);
        expect(column.notNull, `${config.name}.${column.name} nullability`).toBe(actual.not_null);
        if (!actual.default?.startsWith("nextval(")) expect(defaultValue(column.default ?? null, actual.type), `${config.name}.${column.name} default`).toEqual(defaultValue(actual.default, actual.type));
      }
    }
  });
  it("preserves all foreign key names, columns, target columns and deletion actions", async () => {
    const actions = { r: "restrict", c: "cascade", a: "no action", n: "set null", d: "set default" };
    for (const config of all()) {
      const actual = (await pool.query(`SELECT con.conname AS name,con.confdeltype AS action,ref.relname AS target,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY key(num,position) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=key.num ORDER BY position) AS columns,
        ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY key(num,position) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=key.num ORDER BY position) AS target_columns
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ref ON ref.oid=con.confrelid WHERE n.nspname=$1 AND c.relname=$2 AND con.contype='f'`, [schema, config.name])).rows.map((row) => ({ name: row.name, columns: row.columns, target: row.target, targetColumns: row.target_columns, action: actions[row.action as keyof typeof actions] }));
      const declared = config.foreignKeys.map((foreign) => { const ref = foreign.reference(); return { name: foreign.getName(), columns: names(ref.columns), target: getTableName(ref.foreignTable), targetColumns: names(ref.foreignColumns), action: foreign.onDelete ?? "no action" }; });
      expect(sorted(declared), config.name).toEqual(sorted(actual));
    }
  });
  it("preserves unique constraints including NULLS NOT DISTINCT and all check expressions", async () => {
    for (const config of all()) {
      const constraints = (await pool.query(`SELECT con.conname AS name,con.contype AS type,pg_get_constraintdef(con.oid) AS definition,pg_get_expr(con.conbin,con.conrelid) AS expression,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY key(num,position) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=key.num ORDER BY position) AS columns
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND con.contype IN('u','c')`, [schema, config.name])).rows;
      expect(sorted(config.uniqueConstraints.map((unique) => ({ name: unique.name!, columns: names(unique.columns), nullsNotDistinct: unique.nullsNotDistinct }))), config.name).toEqual(sorted(constraints.filter((row) => row.type === "u").map((row) => ({ name: row.name, columns: row.columns, nullsNotDistinct: row.definition.includes("NULLS NOT DISTINCT") }))));
      expect(sorted(config.checks.map((check) => ({ name: check.name, expression: normalizeExpression(expression(check.value)) }))), config.name).toEqual(sorted(constraints.filter((row) => row.type === "c").map((row) => ({ name: row.name, expression: normalizeExpression(row.expression) }))));
    }
  });
  it("preserves index names, column order, direction, null ordering and partial predicates", async () => {
    for (const config of all()) {
      const actual = (await pool.query(`SELECT irel.relname AS name,ix.indisunique AS unique,pg_get_expr(ix.indpred,ix.indrelid) AS predicate,ix.indoption::text AS options,
        ARRAY(SELECT CASE WHEN key.num=0 THEN pg_get_indexdef(ix.indexrelid,key.position::integer,true) ELSE a.attname::text END FROM unnest(ix.indkey) WITH ORDINALITY key(num,position) LEFT JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=key.num ORDER BY position) AS columns
        FROM pg_index ix JOIN pg_class c ON c.oid=ix.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class irel ON irel.oid=ix.indexrelid WHERE n.nspname=$1 AND c.relname=$2 AND NOT ix.indisprimary AND NOT EXISTS(SELECT 1 FROM pg_constraint con WHERE con.conindid=ix.indexrelid)`, [schema, config.name])).rows.map((row) => ({ name: row.name, unique: row.unique, predicate: normalizeExpression(row.predicate), columns: row.columns.map((column: string) => normalizeExpression(column)), options: row.options }));
      const declared = config.indexes.map((index) => ({ name: index.config.name!, unique: index.config.unique, predicate: normalizeExpression(expression(index.config.where)), columns: index.config.columns.map((column) => "name" in column ? normalizeExpression(column.name ?? null) : normalizeExpression(expression(column as SQL))), options: index.config.columns.map((column) => "indexConfig" in column ? (column.indexConfig?.order === "desc" ? 1 : 0) + (column.indexConfig?.nulls === "first" ? 2 : 0) : 0).join(" ") }));
      expect(sorted(declared), config.name).toEqual(sorted(actual));
    }
  });
});
